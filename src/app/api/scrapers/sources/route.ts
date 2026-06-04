import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";
import { SOURCES } from "@/lib/scrapers/registry";

export const runtime = "nodejs";

interface LastRunRow {
  source: string;
  status: string | null;
  finished_at: string | null;
  count_found: number | null;
  duration_ms: number | null;
}
interface CountRow {
  source: string;
  count: string | number;
}

export async function GET() {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();

  // Pull the most recent run per source for this user.
  const lastRuns = (await appSql`
    SELECT DISTINCT ON (source)
      source, status, finished_at, count_found, duration_ms
    FROM os_scrape_runs
    WHERE user_id = ${c.user.id}
    ORDER BY source, started_at DESC
  `) as LastRunRow[];
  const byRunSlug = new Map(lastRuns.map((r) => [r.source, r]));

  // Cached job count per source (for the "X jobs cached" hint in the UI).
  const counts = (await appSql`
    SELECT source, COUNT(*)::text AS count
    FROM os_jobs
    WHERE user_id = ${c.user.id} AND dismissed_at IS NULL
    GROUP BY source
  `) as CountRow[];
  const byCount = new Map(counts.map((c) => [c.source, Number(c.count)]));

  const sources = SOURCES.map((s) => {
    const last = byRunSlug.get(s.slug) || null;
    return {
      slug: s.slug,
      display_name: s.display_name,
      employer: s.employer,
      kind: s.kind,
      url: s.url,
      cached_count: byCount.get(s.slug) ?? 0,
      last_run: last
        ? {
            status: last.status,
            finished_at: last.finished_at,
            count_found: last.count_found,
            duration_ms: last.duration_ms,
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, sources });
}
