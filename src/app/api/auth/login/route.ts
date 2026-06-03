import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { sql, migrate } from "@/lib/cdp/db";
import {
  COOKIE_NAME,
  COOKIE_MAX_AGE,
  createSessionForUser,
  emailIsSuperadminReserved,
  gateUserRow,
  authErrorResponse,
} from "@/lib/cdp/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await migrate();
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email and password required" }, { status: 400 });
  }

  // Refuse superadmin emails up front. Generic 401 — same shape the wrong-
  // password branch returns, so a probe can't tell a superadmin email apart
  // from a non-existent one.
  if (await emailIsSuperadminReserved(email)) {
    return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
  }

  const rows = (await sql`
    SELECT id, email, display_name, password_hash, disabled, is_admin, account_type,
           access_starts_at, access_expires_at, entitlements
    FROM cdp_users WHERE email = ${email}
  `) as Array<{
    id: string;
    email: string;
    display_name: string | null;
    password_hash: string | null;
    disabled: boolean;
    is_admin: boolean | null;
    account_type: string | null;
    access_starts_at: string | null;
    access_expires_at: string | null;
    entitlements: Record<string, unknown> | null;
  }>;

  if (!rows.length || !rows[0].password_hash || rows[0].disabled) {
    return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
  }
  const user = rows[0];
  const matches = await bcrypt.compare(password, user.password_hash!);
  if (!matches) {
    return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
  }

  // Refuse to mint a session for an expired or un-entitled user. The same
  // 403/code that requireUser uses, so the frontend wall picks it up uniformly.
  const gate = gateUserRow(user);
  if (!gate.ok) return authErrorResponse(gate.code);

  await sql`UPDATE cdp_users SET last_login_at = NOW() WHERE id = ${user.id}`;
  const rawToken = await createSessionForUser(user.id);

  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      is_admin: user.is_admin === true,
      account_type: user.account_type ?? null,
    },
    access_starts_at: user.access_starts_at,
    access_expires_at: user.access_expires_at,
    entitlements: user.entitlements || {},
  });
  res.cookies.set({
    name: COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
