import { NextResponse } from "next/server";
import { checkAuth, authErrorResponse } from "@/lib/cdp/auth";
import { appSql, migrate } from "@/lib/cdp/db";

export const runtime = "nodejs";

interface RunRow {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_message: string | null;
  count_found: number | null;
  count_new: number | null;
  count_updated: number | null;
  duration_ms: number | null;
}

export async function GET(req: Request) {
  const c = await checkAuth();
  if (!c.ok) return authErrorResponse(c.code);
  await migrate();

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));

  const rows = (await appSql`
    SELECT id, source, started_at, finished_at, status, error_message,
           count_found, count_new, count_updated, duration_ms
    FROM os_scrape_runs
    WHERE user_id = ${c.user.id}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as RunRow[];

  return NextResponse.json({ ok: true, runs: rows });
}
