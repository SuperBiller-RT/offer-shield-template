"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface LastRun {
  status: string | null;
  finished_at: string | null;
  count_found: number | null;
  duration_ms: number | null;
  error_message?: string | null;
}

interface Source {
  slug: string;
  display_name: string;
  employer: string;
  kind: "static" | "browserless";
  url: string;
  cached_count: number;
  last_run: LastRun | null;
}

interface Job {
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
  last_seen_at: string;
  dismissed_at: string | null;
}

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

interface RunResult {
  source: string;
  status: string;
  count_found: number;
  count_new: number;
  count_updated: number;
  duration_ms: number;
  error_message?: string;
}

const ALL = "all";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 0) return "just now";
  if (sec < 60) return sec + "s ago";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return day + "d ago";
  return new Date(iso).toLocaleDateString();
}

function statusPillStyle(status: string | null): { bg: string; color: string; border: string; label: string } {
  switch (status) {
    case "success":
      return { bg: "var(--green-light)", color: "var(--green)", border: "#a7f3d0", label: "OK" };
    case "partial":
      return { bg: "var(--amber-light)", color: "var(--amber)", border: "#fde68a", label: "Partial" };
    case "failed":
      return { bg: "var(--red-light)", color: "var(--red)", border: "#fecaca", label: "Failed" };
    case "running":
      return { bg: "var(--accent-light)", color: "var(--accent)", border: "#bfdbfe", label: "Running" };
    default:
      return { bg: "var(--surface-alt)", color: "var(--text-muted)", border: "var(--border)", label: "Not run" };
  }
}

export default function ScraperPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const [runningSlugs, setRunningSlugs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const fetchSources = useCallback(async () => {
    const r = await fetch("/api/scrapers/sources", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error("Couldn't load sources (" + r.status + ")");
    const d = await r.json();
    if (!d?.ok) throw new Error(d?.error ?? "Couldn't load sources");
    setSources(d.sources as Source[]);
  }, []);

  const fetchJobs = useCallback(async (sourceSlug: string) => {
    const q = sourceSlug && sourceSlug !== ALL ? `?source=${encodeURIComponent(sourceSlug)}&limit=200` : "?limit=200";
    const r = await fetch("/api/jobs" + q, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error("Couldn't load jobs (" + r.status + ")");
    const d = await r.json();
    if (!d?.ok) throw new Error(d?.error ?? "Couldn't load jobs");
    setJobs(d.jobs as Job[]);
  }, []);

  // Initial load + on-filter-change refetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchSources(), fetchJobs(filter)])
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load data");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchSources, fetchJobs, filter]);

  async function runOne(slug: string) {
    setError(null);
    setRunningSlugs((s) => new Set(s).add(slug));
    try {
      const r = await fetch("/api/scrapers/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: slug }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) throw new Error(d?.error ?? "Scrape failed");
      // Surface any per-run error messages so the source row's inline banner
      // updates without waiting for the sources refetch.
      if (Array.isArray(d.runs)) {
        const failed = (d.runs as RunResult[]).filter((x) => x.status === "failed" || x.status === "partial");
        if (failed.length > 0) {
          setError(failed.map((f) => `${f.source}: ${f.error_message ?? f.status}`).join(" · "));
        }
      }
      await Promise.all([fetchSources(), fetchJobs(filter)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scrape failed");
    } finally {
      setRunningSlugs((s) => {
        const next = new Set(s);
        next.delete(slug);
        return next;
      });
    }
  }

  async function runAll() {
    setError(null);
    setRunningAll(true);
    try {
      const r = await fetch("/api/scrapers/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: ALL }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) throw new Error(d?.error ?? "Scrape failed");
      if (Array.isArray(d.runs)) {
        const failed = (d.runs as RunResult[]).filter((x) => x.status === "failed");
        if (failed.length > 0) {
          setError(`${failed.length} source(s) failed. See per-source row for details.`);
        }
      }
      await Promise.all([fetchSources(), fetchJobs(filter)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scrape failed");
    } finally {
      setRunningAll(false);
    }
  }

  async function dismissJob(id: string) {
    // Optimistic remove; rollback on failure.
    const prev = jobs;
    setJobs((j) => j.filter((x) => x.id !== id));
    try {
      const r = await fetch(`/api/jobs/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error(String(r.status));
      // Sources cached_count needs a refresh too.
      void fetchSources();
    } catch {
      setJobs(prev);
      setError("Couldn't dismiss job. Try again.");
    }
  }

  async function openRuns() {
    setRunsOpen((open) => !open);
    if (!runsOpen && runs.length === 0) {
      setRunsLoading(true);
      try {
        const r = await fetch("/api/scrapers/runs?limit=20", { credentials: "same-origin", cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.ok) setRuns(d.runs as RunRow[]);
      } catch {
        // ignore — drawer just stays empty
      } finally {
        setRunsLoading(false);
      }
    }
  }

  const totalCached = useMemo(() => sources.reduce((sum, s) => sum + s.cached_count, 0), [sources]);
  const sourceBySlug = useMemo(() => new Map(sources.map((s) => [s.slug, s])), [sources]);

  return (
    <div className="scroll-wrap">
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 6, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px", marginBottom: 3 }}>
              Website Scraper
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              Pull live jobs from these construction company careers pages, then dismiss anything that isn&apos;t relevant.
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={runAll}
            disabled={runningAll || loading}
            style={{ flexShrink: 0 }}
          >
            {runningAll ? "Running…" : "Run all"}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "var(--red-light)",
              border: "1px solid #fecaca",
              borderRadius: "var(--radius-sm)",
              fontSize: 12.5,
              color: "var(--red)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              style={{ background: "transparent", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        )}

        {/* ── SOURCES ── */}
        <div className="s-section-title" style={{ marginTop: 22 }}>Sources</div>
        <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
          {loading && sources.length === 0 ? (
            <div style={{ padding: "18px 20px", color: "var(--text-muted)", fontSize: 13 }}>Loading sources…</div>
          ) : sources.length === 0 ? (
            <div style={{ padding: "18px 20px", color: "var(--text-muted)", fontSize: 13 }}>No sources registered.</div>
          ) : (
            sources.map((s, idx) => (
              <SourceRow
                key={s.slug}
                source={s}
                running={runningSlugs.has(s.slug) || runningAll}
                disabled={runningAll}
                onRun={() => runOne(s.slug)}
                bottomBorder={idx < sources.length - 1}
              />
            ))
          )}
        </div>

        {/* ── JOBS ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 22, marginBottom: 10, flexWrap: "wrap" }}>
          <div className="s-section-title" style={{ marginBottom: 0 }}>
            Jobs <span style={{ color: "var(--text-muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· {jobs.length} shown · {totalCached} cached</span>
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-muted)" }}>
            Source
            <select
              className="field-input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: "5px 8px", fontSize: 12, minWidth: 160 }}
            >
              <option value={ALL}>All sources</option>
              {sources.map((s) => (
                <option key={s.slug} value={s.slug}>{s.display_name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
          {loading && jobs.length === 0 ? (
            <div style={{ padding: "18px 20px", color: "var(--text-muted)", fontSize: 13 }}>Loading jobs…</div>
          ) : jobs.length === 0 ? (
            <div style={{ padding: "26px 20px", color: "var(--text-muted)", fontSize: 13, textAlign: "center", lineHeight: 1.55 }}>
              Nothing pulled yet for this filter.<br />Run a source above to populate.
            </div>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 150px 130px 90px 32px", background: "var(--surface-alt)", borderBottom: "1px solid var(--border)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>
                <div style={{ padding: "9px 14px" }}>Title</div>
                <div style={{ padding: "9px 14px" }}>Location</div>
                <div style={{ padding: "9px 14px" }}>Employer</div>
                <div style={{ padding: "9px 14px" }}>Last seen</div>
                <div />
              </div>
              {jobs.map((job) => {
                const s = sourceBySlug.get(job.source);
                const employerLabel = job.employer || s?.employer || job.source;
                return (
                  <div
                    key={job.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) 150px 130px 90px 32px",
                      borderBottom: "1px solid var(--border-light)",
                      fontSize: 12.5,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ padding: "9px 14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={job.title ?? ""}>
                      {job.apply_url ? (
                        <a href={job.apply_url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
                          {job.title || "(untitled)"}
                        </a>
                      ) : (
                        <span>{job.title || "(untitled)"}</span>
                      )}
                    </div>
                    <div style={{ padding: "9px 14px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={job.location ?? ""}>
                      {job.location || "—"}
                    </div>
                    <div style={{ padding: "9px 14px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={employerLabel}>
                      {employerLabel}
                    </div>
                    <div style={{ padding: "9px 14px", color: "var(--text-muted)", fontSize: 11.5 }}>
                      {relativeTime(job.last_seen_at)}
                    </div>
                    <div style={{ padding: "6px 6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={() => dismissJob(job.id)}
                        title="Dismiss job"
                        aria-label="Dismiss job"
                        style={{
                          width: 20, height: 20, borderRadius: 10,
                          background: "transparent",
                          color: "var(--text-muted)",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          lineHeight: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "var(--font)",
                          transition: "background .12s, color .12s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--red-light)";
                          e.currentTarget.style.color = "var(--red)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-muted)";
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RECENT RUNS DRAWER ── */}
        <div style={{ marginTop: 22 }}>
          <button
            type="button"
            onClick={openRuns}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".6px",
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Recent runs
            <span style={{ display: "inline-block", transform: runsOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
          </button>
          {runsOpen && (
            <div className="settings-card" style={{ padding: 0, overflow: "hidden", marginTop: 10 }}>
              {runsLoading ? (
                <div style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 13 }}>Loading runs…</div>
              ) : runs.length === 0 ? (
                <div style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 13 }}>No runs yet.</div>
              ) : (
                runs.map((run, idx) => {
                  const pill = statusPillStyle(run.status);
                  return (
                    <div
                      key={run.id}
                      style={{
                        padding: "10px 16px",
                        borderBottom: idx < runs.length - 1 ? "1px solid var(--border-light)" : "none",
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) 80px 110px 110px",
                        gap: 8,
                        alignItems: "center",
                        fontSize: 12.5,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{sourceBySlug.get(run.source)?.display_name ?? run.source}</div>
                        {run.error_message && (
                          <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 3 }}>{run.error_message}</div>
                        )}
                      </div>
                      <span
                        style={{
                          padding: "2px 10px",
                          borderRadius: 20,
                          background: pill.bg,
                          color: pill.color,
                          border: "1px solid " + pill.border,
                          fontSize: 11,
                          fontWeight: 700,
                          textAlign: "center",
                        }}
                      >
                        {pill.label}
                      </span>
                      <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                        {run.count_new ?? 0} new · {run.count_updated ?? 0} updated
                      </div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                        {relativeTime(run.started_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  running,
  disabled,
  onRun,
  bottomBorder,
}: {
  source: Source;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
  bottomBorder: boolean;
}) {
  const last = source.last_run;
  const pill = statusPillStyle(last?.status ?? null);
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: bottomBorder ? "1px solid var(--border-light)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {source.display_name}
            <span
              style={{
                padding: "1px 8px",
                borderRadius: 20,
                background: source.kind === "browserless" ? "var(--accent-light)" : "var(--surface-alt)",
                color: source.kind === "browserless" ? "var(--accent)" : "var(--text-muted)",
                border: "1px solid " + (source.kind === "browserless" ? "#bfdbfe" : "var(--border)"),
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".5px",
              }}
            >
              {source.kind === "browserless" ? "Chrome" : "Static"}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
            <a href={source.url} target="_blank" rel="noreferrer noopener" style={{ color: "inherit", textDecoration: "underline" }}>
              {source.url.replace(/^https?:\/\//, "")}
            </a>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, fontSize: 12, color: "var(--text-secondary)" }}>
          <span style={{ color: "var(--text-muted)" }}>
            {source.cached_count > 0 ? `${source.cached_count} cached` : "0 cached"}
          </span>
          <span
            style={{
              padding: "2px 10px",
              borderRadius: 20,
              background: pill.bg,
              color: pill.color,
              border: "1px solid " + pill.border,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {pill.label}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 11.5, minWidth: 70, textAlign: "right" }}>
            {last?.finished_at ? relativeTime(last.finished_at) : "never run"}
          </span>
          <button
            type="button"
            className="btn-sec"
            onClick={onRun}
            disabled={running || disabled}
            style={{ minWidth: 64 }}
          >
            {running ? "…" : "Run"}
          </button>
        </div>
      </div>
      {last?.error_message && (
        <div
          style={{
            padding: "7px 10px",
            background: "var(--amber-light)",
            border: "1px solid #fde68a",
            borderRadius: "var(--radius-sm)",
            fontSize: 11.5,
            color: "var(--amber)",
            lineHeight: 1.5,
          }}
        >
          {last.error_message}
        </div>
      )}
    </div>
  );
}
