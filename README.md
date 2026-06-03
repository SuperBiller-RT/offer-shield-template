# offer-shield-template

OfferShield — a recruiter-facing tool that captures **Consideration for Change** signals on individual candidates and sends shareable summaries to candidates and hiring managers.

Part of the SuperBiller CDP suite — shares the `cdp_*` user/auth/usage tables with `recruiter-spy-template`, `vacancy-iq-template`, `vacancyidentifier-template`, and the admin control plane.

## Stack

- Next.js 16 (App Router)
- Neon serverless Postgres — two bindings: shared `user_db_DATABASE_URL` + app-local `DATABASE_URL`
- bcryptjs for password hashing
- Tailwind v4

## Local setup

```bash
npm install
cp .env.example .env.local
# fill in user_db_DATABASE_URL + DATABASE_URL (both can point at the same Neon for dev)
npm run dev
```

## Architecture

See `CLAUDE.md` for the full handover — topology, route map, auth flow, share-link contract, and the "don't break" list.

## Deploy

Auto-deploys to Vercel on every push to `main`. The Vercel project needs both Neon bindings attached before first deploy:

- `user_db_DATABASE_URL` — shared CDP Neon (same DB as the other product apps)
- `DATABASE_URL` — fresh app-local Neon for `os_cases` + `os_share_links`

Live at https://offer-shield-template.vercel.app.
