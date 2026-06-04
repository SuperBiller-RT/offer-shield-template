import { appSql } from "@/lib/cdp/db";
import { fetchRenderedHtml } from "./browserless";
import { SOURCES, SOURCE_BY_SLUG } from "./registry";
import type { RunSummary, ScrapeJob, ScraperContext, SourceDefinition } from "./types";

const STATIC_CONCURRENCY = 4;

function makeCtx(): { ctx: ScraperContext; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: ScraperContext = {
    browserlessHtml: (opts) => fetchRenderedHtml(opts),
    warn: (m) => {
      warnings.push(m);
    },
  };
  return { ctx, warnings };
}

// Insert the os_scrape_runs row up-front and return its id so we can update
// it with the final status + counts once the adapter finishes.
async function openRun(userId: string, source: string): Promise<string> {
  const rows = (await appSql`
    INSERT INTO os_scrape_runs (user_id, source, status)
    VALUES (${userId}, ${source}, ${"running"})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0].id;
}

async function closeRun(
  runId: string,
  patch: { status: "ok" | "error"; error_message?: string | null; count_found: number; count_new: number; count_updated: number; duration_ms: number },
): Promise<void> {
  await appSql`
    UPDATE os_scrape_runs SET
      finished_at  = NOW(),
      status       = ${patch.status},
      error_message= ${patch.error_message ?? null},
      count_found  = ${patch.count_found},
      count_new    = ${patch.count_new},
      count_updated= ${patch.count_updated},
      duration_ms  = ${patch.duration_ms}
    WHERE id = ${runId}
  `;
}

// Upsert one scraped job into os_jobs. Returns whether the row was newly
// inserted (true) or updated (false) so the run summary can split the count.
async function upsertJob(userId: string, def: SourceDefinition, j: ScrapeJob): Promise<{ inserted: boolean }> {
  const payload = JSON.stringify(j.raw ?? {});
  const rows = (await appSql`
    INSERT INTO os_jobs (
      user_id, source, external_id, title, location, employer, apply_url, description, posted_at, source_payload
    ) VALUES (
      ${userId}, ${def.slug}, ${j.external_id},
      ${j.title ?? null},
      ${j.location ?? null},
      ${def.employer},
      ${j.apply_url ?? null},
      ${j.description ?? null},
      ${j.posted_at ?? null},
      ${payload}::jsonb
    )
    ON CONFLICT (user_id, source, external_id) DO UPDATE SET
      title          = EXCLUDED.title,
      location       = EXCLUDED.location,
      employer       = EXCLUDED.employer,
      apply_url      = EXCLUDED.apply_url,
      description    = EXCLUDED.description,
      posted_at      = COALESCE(EXCLUDED.posted_at, os_jobs.posted_at),
      scraped_at     = NOW(),
      last_seen_at   = NOW(),
      source_payload = EXCLUDED.source_payload
    RETURNING (xmax = 0) AS inserted
  `) as Array<{ inserted: boolean }>;
  return { inserted: rows[0]?.inserted === true };
}

async function runOneSource(userId: string, def: SourceDefinition): Promise<RunSummary> {
  const runId = await openRun(userId, def.slug);
  const t0 = Date.now();
  const { ctx, warnings } = makeCtx();
  try {
    const jobs = await def.run(ctx);
    let newCount = 0;
    let updCount = 0;
    for (const j of jobs) {
      if (!j.external_id || !j.title) continue;
      try {
        const { inserted } = await upsertJob(userId, def, j);
        if (inserted) newCount++;
        else updCount++;
      } catch (e) {
        warnings.push(`upsert failed for ${j.external_id}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
      }
    }
    const summary: RunSummary = {
      source: def.slug,
      status: "ok",
      error_message: warnings.length ? warnings.join(" | ").slice(0, 1000) : null,
      count_found: jobs.length,
      count_new: newCount,
      count_updated: updCount,
      duration_ms: Date.now() - t0,
    };
    await closeRun(runId, summary);
    return summary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const summary: RunSummary = {
      source: def.slug,
      status: "error",
      error_message: msg.slice(0, 1000),
      count_found: 0,
      count_new: 0,
      count_updated: 0,
      duration_ms: Date.now() - t0,
    };
    await closeRun(runId, summary).catch(() => {});
    return summary;
  }
}

async function runBounded(targets: SourceDefinition[], userId: string, max: number): Promise<RunSummary[]> {
  const results: RunSummary[] = [];
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= targets.length) return;
      results[idx] = await runOneSource(userId, targets[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(max, targets.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function runSequential(targets: SourceDefinition[], userId: string): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  for (const t of targets) out.push(await runOneSource(userId, t));
  return out;
}

// Public entry point. `source` is either 'all' or a specific slug.
export async function runForUser(userId: string, source: "all" | string): Promise<RunSummary[]> {
  let targets: SourceDefinition[];
  if (source === "all") {
    targets = SOURCES;
  } else {
    const def = SOURCE_BY_SLUG[source];
    if (!def) throw new Error(`unknown source: ${source}`);
    targets = [def];
  }
  const staticT = targets.filter((t) => t.kind === "static");
  const browserT = targets.filter((t) => t.kind === "browserless");
  // Parallel for static (bounded by STATIC_CONCURRENCY), serial for browserless
  // so the shared VPS browserless container isn't hit with multiple sessions
  // from a single user request.
  const [s, b] = await Promise.all([
    runBounded(staticT, userId, STATIC_CONCURRENCY),
    runSequential(browserT, userId),
  ]);
  return [...s, ...b];
}
