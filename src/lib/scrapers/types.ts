// Public shape every scraper adapter returns. Server upserts into os_jobs
// using `external_id` as the per-source dedupe key. Adapters that can't
// derive a stable natural ID fall back to a hash of title+location.
export interface ScrapeJob {
  external_id: string;
  title: string;
  location?: string | null;
  apply_url?: string | null;
  description?: string | null;
  posted_at?: string | null; // ISO 8601 if available
  raw?: Record<string, unknown>;
}

// Per-source metadata the registry exposes to the UI + runner.
export interface SourceDefinition {
  slug: string;
  display_name: string;
  employer: string;          // the company whose jobs this source publishes
  kind: "static" | "browserless";
  url: string;               // canonical "Open in browser" URL for the UI
  run: ScraperFn;
}

export type ScraperFn = (ctx: ScraperContext) => Promise<ScrapeJob[]>;

export interface ScraperContext {
  // Browserless wrapper — only used by adapters whose kind === 'browserless'.
  // Returns the fully-rendered page HTML.
  browserlessHtml: (opts: { url: string; waitForSelector?: string; waitMs?: number }) => Promise<string>;
  // Per-run logger; messages here are surfaced in the os_scrape_runs.error_message
  // column when the adapter completes with warnings but no thrown error.
  warn: (message: string) => void;
}

// What the runner returns per source after a run completes.
export interface RunSummary {
  source: string;
  status: "ok" | "error";
  error_message?: string | null;
  count_found: number;
  count_new: number;
  count_updated: number;
  duration_ms: number;
}
