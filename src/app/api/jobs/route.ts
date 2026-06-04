import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";
import { SOURCE_BY_SLUG } from "@/lib/scrapers/registry";

export const runtime = "nodejs";

interface JobRow {
  id: string;
  source: string;
  external_id: string;
  title: string | null;
  location: string | null;
  employer: string | null;
  apply_url: string | null;
  description: string | null;
  posted_at: string | null;
  scraped_at: string;
  first_seen_at: string;
  last_seen_at: string;
  dismissed_at: string | null;
}

export async function GET(req: Request) {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();

  const url = new URL(req.url);
  const source = (url.searchParams.get("source") || "").trim();
  const includeDismissed = url.searchParams.get("include_dismissed") === "1";
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));

  if (source && source !== "all" && !SOURCE_BY_SLUG[source]) {
    return NextResponse.json({ ok: false, error: `unknown source: ${source}` }, { status: 400 });
  }

  // Build the where-clause incrementally. Neon's tagged-template SQL doesn't
  // support optional joins natively, so use parameter switching.
  const rows = (source && source !== "all"
    ? includeDismissed
      ? await appSql`
          SELECT id, source, external_id, title, location, employer, apply_url, description,
                 posted_at, scraped_at, first_seen_at, last_seen_at, dismissed_at
          FROM os_jobs
          WHERE user_id = ${c.user.id} AND source = ${source}
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `
      : await appSql`
          SELECT id, source, external_id, title, location, employer, apply_url, description,
                 posted_at, scraped_at, first_seen_at, last_seen_at, dismissed_at
          FROM os_jobs
          WHERE user_id = ${c.user.id} AND source = ${source} AND dismissed_at IS NULL
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `
    : includeDismissed
      ? await appSql`
          SELECT id, source, external_id, title, location, employer, apply_url, description,
                 posted_at, scraped_at, first_seen_at, last_seen_at, dismissed_at
          FROM os_jobs
          WHERE user_id = ${c.user.id}
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `
      : await appSql`
          SELECT id, source, external_id, title, location, employer, apply_url, description,
                 posted_at, scraped_at, first_seen_at, last_seen_at, dismissed_at
          FROM os_jobs
          WHERE user_id = ${c.user.id} AND dismissed_at IS NULL
          ORDER BY last_seen_at DESC
          LIMIT ${limit}
        `) as JobRow[];

  return NextResponse.json({ ok: true, jobs: rows });
}
