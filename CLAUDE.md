@AGENTS.md

# OfferShield — handover for a fresh Claude session

A recruiter-facing tool that captures **Consideration for Change** signals on individual candidates and sends shareable summaries to candidates / hiring managers. Part of the SuperBiller CDP suite — one row per human, one wallet, one admin control plane.

This repo is one of several product apps that share the same Neon `user_db` and the same admin control plane (`SuperBiller-RT/admin`). For the data model and the "plug a new tool in" recipe, read `admin/CLAUDE.md` first — especially §2 on the two-database topology.

---

## 0 — Working with this user

- **Pushes are auto-deployed to Vercel.** Don't ask before `git push`.
- **Author identity per commit:** `Max <max@superbiller.com>` via `-c user.name=Max -c user.email=max@superbiller.com`. Don't touch `git config --global`.
- **Don't create PRs** unless explicitly asked.
- **No Claude attribution, no model identifier** in any committed artefact.
- **Never use** `--no-verify`, `--no-gpg-sign`, `--amend` (unless asked).

---

## 1 — Where everything lives

| Surface | Where |
|---|---|
| **Live app** | https://considerationforchange.com (legacy alias `offer-shield-template.vercel.app` 308s here) |
| **GitHub repo** | https://github.com/SuperBiller-RT/offer-shield-template (public) |
| **Vercel project** | `offer-shield-template` · team `superbiller-rts-projects` · auto-deploys from `main` |
| **Tool slug** (pinned) | `offer_shield` |

### Data topology — two DBs

- **Shared `user_db`** — bound as `user_db_DATABASE_URL`. Holds all `cdp_*` tables: identity, sessions, usage ledger, tools registry. Read-write via the shared client exported as `sql` from `src/lib/cdp/db.ts`.
- **App-local DB** — bound as `DATABASE_URL`. Holds **only** `os_cases` (per-user candidate forms) and `os_share_links` (token-addressable read-only views). Read-write via the app-local client exported as `appSql` from `src/lib/cdp/db.ts`.

Until both Neons are attached separately, both env vars may resolve to the same physical Neon. The code works either way; the rule is enforced by which client each query uses.

### Repo layout

```
offer-shield-template/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/                 — login, logout, me, ai-settings, branding,
│   │   │   │                            openrouter-balance, reset-with-key
│   │   │   ├── cases/                — per-user CRUD (app-local, uses appSql)
│   │   │   │   ├── route.ts          — GET list, POST create
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts      — GET one, PATCH update, DELETE
│   │   │   │       └── share/route.ts — POST mint, GET list, DELETE revoke
│   │   │   └── share/[token]/        — public token resolver (no auth)
│   │   ├── c/[token]/                — public candidate-facing summary page
│   │   ├── login/                    — sign-in page
│   │   ├── settings/                 — settings shell
│   │   └── page.tsx                  — Consideration for Change panel
│   ├── components/                   — Header, LoginGate, ConsiderationPanel,
│   │                                   SettingsPanel, SendLinkModal, ...
│   ├── lib/
│   │   ├── cdp/
│   │   │   ├── auth.ts               — checkAuth() against shared cdp_auth_sessions
│   │   │   ├── db.ts                 — TWO Neon clients: sql + appSql; migrate()
│   │   │   ├── settings.ts           — getUserAiSettings, getUserBranding, save*
│   │   │   └── usage.ts              — recordUsage() pinned to app_slug='offer_shield'
│   │   │                              (no metered services yet; stub for parity)
│   │   └── constants.ts              — APP_SLUG='offer_shield'
│   └── app/globals.css
├── AGENTS.md
├── CLAUDE.md                          — this file
└── package.json                       — Next.js 16, Neon serverless, bcryptjs
```

---

## 2 — Auth flow

Same cookie-based session pattern as recruiter-spy / vacancy-iq:

1. `POST /api/auth/login` with `{email, password}` → bcrypt compare → mint cdp_auth_sessions row → set `cdp_session` cookie.
2. Every server route calls `await checkAuth()` from `lib/cdp/auth.ts`. The check JOINs `cdp_auth_sessions` × `cdp_users` and applies the access-window + entitlement gate (`entitlements.offer_shield !== false`).
3. `GET /api/auth/me` returns the full user record + effective permissions for the client wall (`LoginGate.tsx`).
4. `POST /api/auth/logout` revokes the session row + clears the cookie.
5. Public self-service password reset at `POST /api/auth/reset-with-key` — bcrypt compare against `cdp_users.recovery_key_hash`, anti-enumeration via timing-equalised dummy hash on miss.

Trial users use admin-provisioned shared keys; members and admins paste their own via Settings. `effectivePermissions(user)` returns the canonical `canInsertKeys` / `canSeeBalance` flags — gate both UI and server routes on these.

---

## 3 — Cases + share-link flow

- `GET /api/cases` — list current user's cases (200 max).
- `POST /api/cases` — create. Required: `name`. Optional: stage, risk, recruiter, current_role, new_role, contract_status, banner, notes, signals (number array, max 32).
- `PATCH /api/cases/:id` — partial update. Allowed fields enumerated in `ALLOWED_FIELDS`. signals replaces the whole array.
- `DELETE /api/cases/:id` — also revokes outstanding share links for this case.
- `POST /api/cases/:id/share` — mint a `os_share_links` row, returns `{token, url}`.
- `GET /api/cases/:id/share` — list links for this case.
- `DELETE /api/cases/:id/share?token=…` — revoke a link.
- `GET /api/share/:token` — **public, no auth**. Resolves the token to `{case, sender}`. Returns 404 on unknown / revoked / expired (anti-enumeration). Used by `app/c/[token]/page.tsx`.

---

## 4 — No LLM features in this round

Max #2668 explicitly scoped LLM features out: the OR key field exists but no metered endpoints call OpenRouter yet. `recordUsage` and the OR balance route are wired for parity so future features plug straight in.

If you add an LLM call:
1. Follow the rspy pattern in `recruiter-spy-template/CLAUDE.md` §3.
2. Add `checkBudget()` if the service should be metered against trial caps.
3. Set `usage: { include: true }` and `void recordUsage({ userId, service:'openrouter', costUsd: r.usage?.cost ?? 0, units: r.usage?.total_tokens ?? 0, model, meta: { endpoint } })`. Fire-and-forget.
4. Register the new service in admin's `cdp_tools` row if trial budgets should apply.

---

## 5 — Don't break

- **Don't fork the cdp_* schema.** Migrations in `src/lib/cdp/db.ts` mirror admin's canonical `init-db.ts` — additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS` only.
- **Don't mix the two sql clients.** `cdp_*` queries → `sql`. `os_*` queries → `appSql`. Mixing them undermines the topology rule and silently breaks once `DATABASE_URL` is repointed.
- **Don't expose `cdp_users.openrouter_keys` values in client responses.** Send the last 4 characters as a hint only (see `publicShape` in `ai-settings/route.ts`).
- **Don't write to `cdp_users.usage` JSONB.** Deprecated. The ledger is the source of truth.

---

## 6 — Verification after a push

1. Vercel deploy → READY (Vercel MCP `get_deployment`).
2. Hit the live URL, sign in with a seeded user.
3. Create a case → verify it persists across reload.
4. Mint a share link → open the `/c/<token>` URL in a private window → confirm read-only render works without a session cookie.
5. Settings → paste OR key → confirm balance pill renders (members + admins only).
