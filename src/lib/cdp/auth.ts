import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { sql, migrate } from "./db";

export const COOKIE_NAME = "cdp_session";
export const COOKIE_MAX_AGE = 315_360_000; // 10 years

// Slug this app uses in cdp_users.entitlements. The shared admin can set
// `entitlements.offer_shield = false` to block a user from THIS app only.
export const APP_SLUG = "offer_shield";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface CdpUser {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  account_type: string | null;
  can_insert_keys: boolean;
  can_see_balance: boolean;
}

export type AuthFailureCode = "UNAUTHENTICATED" | "ACCESS_EXPIRED" | "NOT_ENTITLED" | "ACCESS_NOT_STARTED";

export type AuthCheck =
  | {
      ok: true;
      user: CdpUser;
      access_starts_at: string | null;
      access_expires_at: string | null;
      entitlements: Record<string, unknown>;
    }
  | { ok: false; code: AuthFailureCode };

interface AuthRow {
  user_id: string;
  email: string;
  display_name: string | null;
  disabled: boolean;
  is_admin: boolean | null;
  account_type: string | null;
  can_insert_keys: boolean | null;
  can_see_balance: boolean | null;
  access_starts_at: string | null;
  access_expires_at: string | null;
  entitlements: Record<string, unknown> | null;
}

// Revokes the session row backing this token. Used by the gate when we detect
// the access window has lapsed or the entitlement was flipped off — the cookie
// will then be inert on every subsequent request.
async function revokeSessionByHash(tokenHash: string): Promise<void> {
  await sql`UPDATE cdp_auth_sessions SET revoked_at = NOW() WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`;
}

export async function checkAuth(): Promise<AuthCheck> {
  await migrate();
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return { ok: false, code: "UNAUTHENTICATED" };
  const tokenHash = sha256(raw);
  const rows = (await sql`
    SELECT s.user_id,
           u.email,
           u.display_name,
           u.disabled,
           u.is_admin,
           u.account_type,
           u.can_insert_keys,
           u.can_see_balance,
           u.access_starts_at,
           u.access_expires_at,
           u.entitlements
    FROM cdp_auth_sessions s
    JOIN cdp_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
      AND s.revoked_at IS NULL
      AND u.disabled = FALSE
  `) as AuthRow[];
  if (!rows.length) return { ok: false, code: "UNAUTHENTICATED" };
  const row = rows[0];

  const now = Date.now();
  if (row.access_starts_at && new Date(row.access_starts_at).getTime() > now) {
    return { ok: false, code: "ACCESS_NOT_STARTED" };
  }
  if (row.access_expires_at && new Date(row.access_expires_at).getTime() < now) {
    // Kill the session — cookie becomes inert from here.
    void revokeSessionByHash(tokenHash);
    return { ok: false, code: "ACCESS_EXPIRED" };
  }

  const ent = row.entitlements || {};
  if (ent[APP_SLUG] === false) {
    void revokeSessionByHash(tokenHash);
    return { ok: false, code: "NOT_ENTITLED" };
  }

  // Fire-and-forget touch — best-effort, no await.
  void sql`UPDATE cdp_auth_sessions SET last_used_at = NOW() WHERE token_hash = ${tokenHash}`;
  return {
    ok: true,
    user: {
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      is_admin: row.is_admin === true,
      account_type: row.account_type ?? null,
      can_insert_keys: row.can_insert_keys === true,
      can_see_balance: row.can_see_balance === true,
    },
    access_starts_at: row.access_starts_at,
    access_expires_at: row.access_expires_at,
    entitlements: ent,
  };
}

// Back-compat: callers that don't need the gate reason still work — they just
// see null on both "no session" and "session was rejected by the gate".
export async function getCurrentUser(): Promise<CdpUser | null> {
  const c = await checkAuth();
  return c.ok ? c.user : null;
}

// Canonical 401/403 response for the four AuthCheck failure modes. The body
// shape (`code`, `error`) is what the frontend wall and watchdog look for.
export function authErrorResponse(code: AuthFailureCode): NextResponse {
  if (code === "UNAUTHENTICATED") {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  if (code === "ACCESS_NOT_STARTED") {
    return NextResponse.json(
      { ok: false, code, error: "Your access has not started yet." },
      { status: 403 }
    );
  }
  if (code === "ACCESS_EXPIRED") {
    return NextResponse.json(
      { ok: false, code, error: "Your trial has expired." },
      { status: 403 }
    );
  }
  return NextResponse.json(
    { ok: false, code, error: "You do not have access to this app." },
    { status: 403 }
  );
}

// Single source of truth for canSeeBalance / canInsertKeys.
// trial → always false | is_admin → always true | member → respect toggles.
export function effectivePermissions(user: CdpUser): { canSeeBalance: boolean; canInsertKeys: boolean } {
  if (user.account_type === "trial") return { canSeeBalance: false, canInsertKeys: false };
  if (user.is_admin === true)        return { canSeeBalance: true,  canInsertKeys: true  };
  return {
    canSeeBalance: user.can_see_balance === true,
    canInsertKeys: user.can_insert_keys === true,
  };
}

// Convenience for the access-window/entitlement check used at login, where we
// need to read fresh values straight off the cdp_users row (no session yet).
export function gateUserRow(row: {
  access_starts_at: string | null;
  access_expires_at: string | null;
  entitlements: Record<string, unknown> | null;
}): { ok: true } | { ok: false; code: AuthFailureCode } {
  const now = Date.now();
  if (row.access_starts_at && new Date(row.access_starts_at).getTime() > now) {
    return { ok: false, code: "ACCESS_NOT_STARTED" };
  }
  if (row.access_expires_at && new Date(row.access_expires_at).getTime() < now) {
    return { ok: false, code: "ACCESS_EXPIRED" };
  }
  if ((row.entitlements || {})[APP_SLUG] === false) {
    return { ok: false, code: "NOT_ENTITLED" };
  }
  return { ok: true };
}

export async function createSessionForUser(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = sha256(raw);
  const h = await headers();
  const ua = h.get("user-agent") || null;
  const xff = h.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0].trim() : h.get("x-real-ip");
  await sql`
    INSERT INTO cdp_auth_sessions (token_hash, user_id, user_agent, ip)
    VALUES (${tokenHash}, ${userId}, ${ua}, ${ip})
  `;
  return raw;
}

export async function revokeSession(rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await revokeSessionByHash(tokenHash);
}

// Treat any email present in admin_superadmins as a reserved control-plane
// identity. Product-app login + password-reset routes call this BEFORE
// matching the password, so even if a cdp_users row exists for that email
// (e.g. from a manual seed or a future migration drift), authentication is
// refused with the same generic 401 the wrong-password path returns. This
// is the auth-time replacement for the old migrate-time DELETE that used
// to wipe superadmin emails out of cdp_users on every cold start.
export async function emailIsSuperadminReserved(email: string): Promise<boolean> {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return false;
  try {
    const rows = (await sql`
      SELECT 1 AS one FROM admin_superadmins
      WHERE LOWER(username) = ${normalized}
      LIMIT 1
    `) as Array<{ one: number }>;
    return rows.length > 0;
  } catch {
    // The admin_superadmins table may not exist in environments that haven't
    // run admin's migration. In that case there's nothing to block against.
    return false;
  }
}
