import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// ─── Two-database topology ───────────────────────────────────────────────
// Org rule (locked in across all SuperBiller product apps):
//   1. One shared `user_db` for every cdp_* table — owned by the admin
//      control plane, read-write by every product app via the
//      `user_db_DATABASE_URL` Vercel env var.
//   2. One app-local DB per product app for its own tables (here:
//      os_cases + os_share_links) — bound as `DATABASE_URL`.
//
// Until each app has both Neons attached, the two URLs can point at the
// same database without breaking anything (each query runs against the
// resolved connection; same physical row store). The migration to two
// physically separate Neons happens at the Vercel-env-var / Storage layer,
// not in code.
let _userSql: NeonQueryFunction<false, false> | null = null;
let _appSql:  NeonQueryFunction<false, false> | null = null;

function getUserSql(): NeonQueryFunction<false, false> {
  if (_userSql) return _userSql;
  // Prefer the suite-canonical name `user_db_DATABASE_URL`. On this Vercel
  // project the shared user_db Neon was attached without a prefix (it was
  // the first attach), so it lands on plain `DATABASE_URL` — accept that
  // as the fall-through so we don't force a rename.
  const url = process.env.user_db_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("user_db_DATABASE_URL (or DATABASE_URL) is not configured");
  _userSql = neon(url);
  return _userSql;
}

function getAppSql(): NeonQueryFunction<false, false> {
  if (_appSql) return _appSql;
  // App-local Neon. On Vercel this is the `offer_shield_db` integration —
  // its env vars carry an `offer_shield_db_` prefix because it was the
  // second Neon attached. For local dev with a single Neon, leaving only
  // `DATABASE_URL` set is fine — both clients then resolve to the same row
  // store, which the topology rule allows as a transitional state.
  const url = process.env.offer_shield_db_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("offer_shield_db_DATABASE_URL (or DATABASE_URL) is not configured");
  _appSql = neon(url);
  return _appSql;
}

function proxyOf(getter: () => NeonQueryFunction<false, false>): NeonQueryFunction<false, false> {
  return new Proxy(
    (() => {}) as unknown as NeonQueryFunction<false, false>,
    {
      get(_target, prop) {
        const s = getter() as unknown as Record<string | symbol, unknown>;
        return s[prop];
      },
      apply(_target, _thisArg, args: unknown[]) {
        return (getter() as unknown as (...a: unknown[]) => unknown)(...args);
      },
    },
  );
}

export const sql:    NeonQueryFunction<false, false> = proxyOf(getUserSql);
export const appSql: NeonQueryFunction<false, false> = proxyOf(getAppSql);

let migratePromise: Promise<void> | null = null;

async function runMigrations(): Promise<void> {
  const u = getUserSql();
  const a = getAppSql();

  // cdp_* tables → shared user_db. Mirror the canonical admin schema so a
  // cold deploy works regardless of which side ran its migration first.
  await u.transaction([
    u`
      CREATE TABLE IF NOT EXISTS cdp_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        disabled BOOLEAN DEFAULT FALSE
      )
    `,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS openrouter_key TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS openrouter_keys JSONB DEFAULT '{}'::jsonb`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS openrouter_model TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS openrouter_models JSONB DEFAULT '{}'::jsonb`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_banner TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_banner_height INT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_banner_scale DOUBLE PRECISION`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_banner_offset_x DOUBLE PRECISION`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_banner_offset_y DOUBLE PRECISION`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_banner_frame_width DOUBLE PRECISION`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_company_name TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS brand_footer TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS access_starts_at TIMESTAMPTZ`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS entitlements JSONB DEFAULT '{}'::jsonb`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS account_type TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS can_insert_keys BOOLEAN DEFAULT FALSE`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS can_see_balance BOOLEAN DEFAULT FALSE`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS enforce_limits BOOLEAN`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS budgets JSONB DEFAULT '{}'::jsonb`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS usage_period_starts JSONB DEFAULT '{}'::jsonb`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS recovery_key_hash TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS recovery_key_last4 TEXT`,
    u`ALTER TABLE cdp_users ADD COLUMN IF NOT EXISTS recovery_key_set_at TIMESTAMPTZ`,
    u`CREATE INDEX IF NOT EXISTS cdp_users_access_expires_idx ON cdp_users(access_expires_at)`,
    u`
      CREATE TABLE IF NOT EXISTS cdp_auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES cdp_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ DEFAULT NOW(),
        user_agent TEXT,
        ip TEXT,
        revoked_at TIMESTAMPTZ
      )
    `,
    u`CREATE INDEX IF NOT EXISTS cdp_auth_sessions_user_idx ON cdp_auth_sessions(user_id)`,
    u`
      CREATE TABLE IF NOT EXISTS cdp_usage_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES cdp_users(id) ON DELETE CASCADE,
        app_slug TEXT NOT NULL,
        service TEXT NOT NULL,
        cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
        units NUMERIC(14,6) NOT NULL DEFAULT 0,
        model TEXT,
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    u`CREATE INDEX IF NOT EXISTS cdp_usage_events_user_app_service_idx
        ON cdp_usage_events(user_id, app_slug, service, created_at DESC)`,
  ]);

  // App-local tables → DATABASE_URL. Two tables: os_cases (per-user
  // candidate forms) and os_share_links (token-addressable read-only
  // view of a case for the "Send link to candidate" flow).
  await a.transaction([
    a`
      CREATE TABLE IF NOT EXISTS os_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        name TEXT,
        stage TEXT,
        risk TEXT,
        recruiter TEXT,
        current_title TEXT,
        new_role TEXT,
        contract_status TEXT,
        banner TEXT,
        notes TEXT,
        signals JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
    // Consideration-for-Change form state: value chips (array of indices),
    // role-comparison verdicts (per-factor 'left'|'right'|'both'), financial-
    // comparison rows (per-row {l,r} free-text), candidate's own reasons.
    a`ALTER TABLE os_cases ADD COLUMN IF NOT EXISTS consideration JSONB DEFAULT '{}'::jsonb`,
    a`CREATE INDEX IF NOT EXISTS os_cases_user_idx ON os_cases(user_id, updated_at DESC)`,
    a`
      CREATE TABLE IF NOT EXISTS os_share_links (
        token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )
    `,
    a`CREATE INDEX IF NOT EXISTS os_share_links_case_idx ON os_share_links(case_id)`,
  ]);
}

export function migrate(): Promise<void> {
  if (!migratePromise) {
    migratePromise = runMigrations().catch((e) => {
      migratePromise = null;
      // Surface full driver detail to runtime logs — Vercel truncates to ~30
      // chars in the activity feed and `error.message` alone hides the
      // failing SQL / position. Stay verbose until we have a clean cold-start.
      const err = e as { message?: string; code?: string; severity?: string; position?: string; query?: string; routine?: string };
      console.error("[migrate] failed:", {
        message: err?.message,
        code: err?.code,
        severity: err?.severity,
        position: err?.position,
        routine: err?.routine,
        query: err?.query,
      });
      throw e;
    });
  }
  return migratePromise;
}
