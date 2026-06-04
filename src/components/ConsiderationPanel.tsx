"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportModal from "./ExportModal";
import { VALUE_LABELS, COMPARISON_FACTORS, FINANCIAL_ROWS } from "./consideration-constants";
const FIN_TOTAL_IDX = 7;
const FIN_WFH_IDX = 6;
const FIN_PENSION_IDX = 4;
// Currency rows roll up into the Total pill; the % row (Pension) is shown but
// not summed — typing "6%" mustn't bump the total by £6.
const FIN_CURRENCY_INDICES = [0, 1, 2, 3, 5, 6];

type Verdict = "left" | "right" | "both";

interface Consideration {
  values: number[];
  comparison: Record<string, Verdict>;
  financial: Record<string, { l: string; r: string }>;
  candidate_reasons: string;
}

interface CaseRow {
  id: string;
  name: string | null;
  stage: string | null;
  risk: string | null;
  recruiter: string | null;
  current_role: string | null;
  new_role: string | null;
  contract_status: string | null;
  banner: string | null;
  notes: string | null;
  signals: unknown;
  consideration?: Consideration | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_CONSIDERATION: Consideration = {
  values: [],
  comparison: {},
  financial: {},
  candidate_reasons: "",
};

function parseGbp(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtGbp(n: number): string {
  return n <= 0 ? "—" : "£" + Math.round(n).toLocaleString("en-GB");
}
function calcTotals(fin: Record<string, { l: string; r: string }>) {
  let tl = 0, tr = 0;
  for (const i of FIN_CURRENCY_INDICES) {
    const row = fin[String(i)];
    if (row) {
      tl += parseGbp(row.l ?? "");
      tr += parseGbp(row.r ?? "");
    }
  }
  return { tl, tr };
}

function splitRole(s: string | null): { title: string; company: string } {
  if (!s) return { title: "", company: "" };
  const at = s.indexOf("@");
  if (at < 0) return { title: s.trim(), company: "" };
  return { title: s.slice(0, at).trim(), company: s.slice(at + 1).trim() };
}

export default function ConsiderationPanel() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [draft, setDraft] = useState<Consideration>(EMPTY_CONSIDERATION);
  const [recruiterNotes, setRecruiterNotes] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exportOpen, setExportOpen] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");

  // Load cases on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cases", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.ok) { setLoading(false); return; }
        const list = (d.cases as CaseRow[]) ?? [];
        setCases(list);
        if (list.length > 0) {
          setActiveId(list[0].id);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Sync form state when active case changes.
  const activeCase = useMemo(
    () => cases.find((c) => c.id === activeId) ?? null,
    [cases, activeId],
  );

  useEffect(() => {
    if (!activeCase) {
      setDraft(EMPTY_CONSIDERATION);
      setRecruiterNotes("");
      lastSavedRef.current = "";
      return;
    }
    const cons = activeCase.consideration ?? EMPTY_CONSIDERATION;
    // Normalise the consideration once so the JSON.stringify in the autosave
    // path produces an identical string to the one we stash here. Without
    // this, the echo PATCH on the server's round-trip uses our key-order
    // (values / comparison / financial / candidate_reasons) while the ref was
    // initialised from the server's jsonb shape (Postgres-ordered) — mismatch
    // makes every cycle look like a real edit and the autosave loops forever.
    const normalised: Consideration = {
      values: cons.values ?? [],
      comparison: cons.comparison ?? {},
      financial: cons.financial ?? {},
      candidate_reasons: cons.candidate_reasons ?? "",
    };
    setDraft(normalised);
    setRecruiterNotes(activeCase.notes ?? "");
    setNewCompany(activeCase.new_role ?? "");
    setCurrentCompany(activeCase.current_role ?? "");
    lastSavedRef.current = JSON.stringify({
      consideration: normalised,
      notes: activeCase.notes ?? "",
      new_role: activeCase.new_role ?? "",
      current_role: activeCase.current_role ?? "",
    });
    setSaveStatus("idle");
  }, [activeCase]);

  // Debounced autosave.
  const scheduleSave = useCallback(() => {
    if (!activeId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      const payload = {
        consideration: draft,
        notes: recruiterNotes,
        new_role: newCompany,
        current_role: currentCompany,
      };
      const serialized = JSON.stringify(payload);
      if (serialized === lastSavedRef.current) {
        setSaveStatus("saved");
        return;
      }
      try {
        const r = await fetch(`/api/cases/${activeId}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: serialized,
        });
        if (!r.ok) throw new Error(String(r.status));
        lastSavedRef.current = serialized;
        setSaveStatus("saved");
        // Refresh the case row in memory so updated_at is current.
        const d = await r.json().catch(() => null);
        if (d?.ok && d.case) {
          setCases((prev) => prev.map((c) => (c.id === activeId ? d.case : c)));
        }
      } catch {
        setSaveStatus("error");
      }
    }, 700);
  }, [activeId, draft, recruiterNotes, newCompany, currentCompany]);

  // Auto-save whenever editable state changes.
  useEffect(() => {
    if (!activeId) return;
    scheduleSave();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, recruiterNotes, newCompany, currentCompany, activeId, scheduleSave]);

  function toggleValue(i: number) {
    setDraft((d) => {
      const has = d.values.includes(i);
      return {
        ...d,
        values: has ? d.values.filter((x) => x !== i) : [...d.values, i],
      };
    });
  }

  function cycleVerdict(idx: number, side: "left" | "right") {
    setDraft((d) => {
      const cur = d.comparison[String(idx)] ?? null;
      let next: Verdict | null;
      if (side === "left") {
        next = cur === "left" ? null : cur === "right" ? "both" : cur === "both" ? "right" : "left";
      } else {
        next = cur === "right" ? null : cur === "left" ? "both" : cur === "both" ? "left" : "right";
      }
      const comparison = { ...d.comparison };
      if (next === null) delete comparison[String(idx)];
      else comparison[String(idx)] = next;
      return { ...d, comparison };
    });
  }

  function updateFin(idx: number, side: "l" | "r", value: string) {
    setDraft((d) => {
      const cur = d.financial[String(idx)] ?? { l: "", r: "" };
      return {
        ...d,
        financial: { ...d.financial, [String(idx)]: { ...cur, [side]: value } },
      };
    });
  }

  async function createCase(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await fetch("/api/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok && d.case) {
        setCases((prev) => [d.case, ...prev]);
        setActiveId(d.case.id);
        setNewName("");
      } else {
        alert(d?.error ?? "Could not create case");
      }
    } catch {
      alert("Network error");
    } finally {
      setCreating(false);
    }
  }

  // Headers prefer the user-typed company values; fall back to a parsed "Title
  // @ Company" string for cases that pre-date the editable inputs.
  const leftSplit = useMemo(() => splitRole(newCompany || null), [newCompany]);
  const rightSplit = useMemo(() => splitRole(currentCompany || null), [currentCompany]);
  const leftHeader = leftSplit.company || leftSplit.title || "New company";
  const rightHeader = rightSplit.company || rightSplit.title || "Current company";

  const { tl, tr } = calcTotals(draft.financial);
  let leftScore = 0, rightScore = 0;
  for (let i = 0; i < COMPARISON_FACTORS.length; i++) {
    const v = draft.comparison[String(i)];
    if (v === "left") leftScore++;
    else if (v === "right") rightScore++;
    else if (v === "both") { leftScore++; rightScore++; }
  }

  let insightTone: "good" | "warn" | null = null;
  if (leftScore > rightScore + 2) insightTone = "good";
  else if (rightScore > leftScore) insightTone = "warn";

  return (
    <>
      <div className="dc-outer">
        <div className="dc-inner">
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.2px", marginBottom: 4 }}>
              Consideration for Change
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              Side-by-side comparison of how the new role compares. Not a risk score. Helps build and test the case for the move.
            </div>
          </div>

          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          ) : cases.length === 0 ? (
            <form
              onSubmit={createCase}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 22,
                boxShadow: "var(--shadow-sm)",
                maxWidth: 460,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                Start a new case
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Capture a candidate's reasons for change, weigh new vs. current role, and share with them.
              </div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Candidate name
              </label>
              <input
                className="field-input"
                style={{ width: "100%", marginBottom: 14 }}
                placeholder="e.g. James Hartley"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              <button type="submit" className="btn-primary" disabled={creating || !newName.trim()}>
                {creating ? "Creating…" : "Create case"}
              </button>
            </form>
          ) : (
            <>
              {/* Case selector + save status */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>Candidate</label>
                <select
                  className="field-input"
                  value={activeId ?? ""}
                  onChange={(e) => setActiveId(e.target.value)}
                  style={{ minWidth: 220 }}
                >
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? "Unnamed"}</option>
                  ))}
                </select>
                <NewCaseInline onCreated={(c) => {
                  setCases((prev) => [c, ...prev]);
                  setActiveId(c.id);
                }} />
                <span style={{ marginLeft: "auto", fontSize: 11, color: saveStatus === "error" ? "var(--red)" : "var(--text-muted)" }}>
                  {saveStatus === "saving" ? "Saving…" :
                    saveStatus === "saved" ? "Saved" :
                      saveStatus === "error" ? "Save failed" : ""}
                </span>
              </div>

              {/* Value chips + Export button */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4, gap: 16, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                    What really matters to you in your work?
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                    <button className="btn-primary" type="button" onClick={() => setExportOpen(true)}>
                      Export
                    </button>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Download a PDF to share</span>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
                  Which of these do you feel you&apos;re not fully getting in your current company?
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                  {VALUE_LABELS.map((lbl, i) => {
                    const on = draft.values.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleValue(i)}
                        className={"value-chip" + (on ? " on" : "")}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Candidate reasons */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                  Your reasons for making this move
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
                  In your own words. What made you want to explore a new role? This will be included in your summary.
                </div>
                <textarea
                  className="field-input"
                  style={{ width: "100%", minHeight: 80, resize: "vertical", fontSize: 12.5, background: "var(--surface-alt)" }}
                  placeholder="e.g. I've been passed over for promotion twice and I need to feel valued again."
                  value={draft.candidate_reasons}
                  onChange={(e) => setDraft((d) => ({ ...d, candidate_reasons: e.target.value }))}
                />
              </div>

              {/* Company labels for both comparison tables */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 }}>
                    New company
                  </label>
                  <input
                    className="field-input"
                    style={{ width: "100%" }}
                    placeholder="e.g. Nexus Dynamics"
                    value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)", marginBottom: 6 }}>
                    Current company
                  </label>
                  <input
                    className="field-input"
                    style={{ width: "100%" }}
                    placeholder="e.g. Apex Tech"
                    value={currentCompany}
                    onChange={(e) => setCurrentCompany(e.target.value)}
                  />
                </div>
              </div>

              {/* Role comparison */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Role Comparison</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                  Click each row to indicate which company is stronger for that factor.
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 1fr" }}>
                    <div style={{ background: "var(--accent-light)", padding: "9px 14px", fontSize: 11.5, fontWeight: 700, color: "var(--accent)", borderRight: "1px solid #bfdbfe" }}>
                      {leftHeader}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                      vs
                    </div>
                    <div style={{ background: "var(--surface-alt)", padding: "9px 14px", fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", borderLeft: "1px solid var(--border-light)" }}>
                      {rightHeader}
                    </div>
                  </div>
                  {COMPARISON_FACTORS.map((factor, i) => {
                    const v = draft.comparison[String(i)] ?? null;
                    const lc = v === "left" ? "win" : v === "both" ? "both" : v === "right" ? "lose" : "";
                    const rc = v === "right" ? "win" : v === "both" ? "both" : v === "left" ? "lose" : "";
                    const ltick = v === "left" || v === "both";
                    const rtick = v === "right" || v === "both";
                    return (
                      <div key={i} className="cr-row">
                        <div className={"cr-cell cr-cell-l " + lc} onClick={() => cycleVerdict(i, "left")}>
                          <div className="cr-tick">{ltick ? "✓" : ""}</div>
                          <span>{factor}</span>
                        </div>
                        <div className="cr-mid">
                          <div className="cr-factor">{factor.split(" ")[0]}</div>
                        </div>
                        <div className={"cr-cell cr-cell-r " + rc} onClick={() => cycleVerdict(i, "right")}>
                          <div className="cr-tick">{rtick ? "✓" : ""}</div>
                          <span>{factor}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 1fr", borderTop: "2px solid var(--border)" }}>
                    <div style={{ background: "var(--accent-light)", padding: "10px 14px" }}>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "var(--accent)" }}>{leftScore}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>factors favour new role</div>
                    </div>
                    <div />
                    <div style={{ background: "var(--surface-alt)", padding: "10px 14px" }}>
                      <div style={{ fontSize: 22, fontWeight: 900 }}>{rightScore}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>factors favour current role</div>
                    </div>
                  </div>
                </div>
                {insightTone === "good" && (
                  <div className="insight-box" style={{ borderLeftColor: "var(--green)" }}>
                    The new role is stronger across most factors. This is a well-supported move.
                  </div>
                )}
                {insightTone === "warn" && (
                  <div className="insight-box" style={{ borderLeftColor: "var(--amber)" }}>
                    The current role is scoring stronger on several factors. Use the comparison to identify what needs to be addressed in conversation.
                  </div>
                )}
              </div>

              {/* Recruiter notes */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                  Recruiter notes
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
                  Your recruiter&apos;s observations. Context that doesn&apos;t fit neatly into a tick. This will appear in the shared summary.
                </div>
                <textarea
                  className="field-input"
                  style={{ width: "100%", minHeight: 80, resize: "vertical", fontSize: 12.5, background: "var(--surface-alt)" }}
                  placeholder="e.g. Manager at Nexus has a strong track record of promoting from within."
                  value={recruiterNotes}
                  onChange={(e) => setRecruiterNotes(e.target.value)}
                />
              </div>

              {/* Financial comparison */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Financial Comparison</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                  Full package comparison to make the financial picture clear.
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>Item</div>
                    <div style={{ padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--accent)" }}>{leftHeader}</div>
                    <div style={{ padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>{rightHeader}</div>
                  </div>
                  {FINANCIAL_ROWS.map((label, i) => {
                    if (i === FIN_TOTAL_IDX) {
                      const lHigh = tl > tr && tl > 0;
                      const rHigh = tr > tl && tr > 0;
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--surface-alt)", borderTop: "2px solid var(--border)" }}>
                          <div style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)" }}>{label}</div>
                          <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800, color: lHigh ? "var(--green)" : "var(--text-primary)" }}>{fmtGbp(tl)}</div>
                          <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800, color: rHigh ? "var(--green)" : "var(--text-primary)" }}>{fmtGbp(tr)}</div>
                        </div>
                      );
                    }
                    const row = draft.financial[String(i)] ?? { l: "", r: "" };
                    const isPension = i === FIN_PENSION_IDX;
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--border-light)" }}>
                        <div style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                          {label}
                          {i === FIN_WFH_IDX && (
                            <span title="Includes remote working allowance plus estimated yearly savings." style={{ fontSize: 10, color: "var(--accent)", cursor: "help" }}>
                              ⓘ
                            </span>
                          )}
                        </div>
                        <div style={{ padding: "6px 10px" }}>
                          <FinAdornedInput
                            unit={isPension ? "%" : "£"}
                            placement={isPension ? "suffix" : "prefix"}
                            value={row.l}
                            onChange={(v) => updateFin(i, "l", v)}
                          />
                        </div>
                        <div style={{ padding: "6px 10px" }}>
                          <FinAdornedInput
                            unit={isPension ? "%" : "£"}
                            placement={isPension ? "suffix" : "prefix"}
                            value={row.r}
                            onChange={(v) => updateFin(i, "r", v)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                  WFH allowance / cost saving includes remote working allowance plus estimated yearly savings from reduced travel and office costs.
                </div>
              </div>

              {/* Total summary strip */}
              <div style={{ marginBottom: 20, marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 10 }}>
                  Estimated total annual package
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <TotalPill label={leftHeader} value={tl} highlight={tl > tr && tl > 0} />
                  <TotalPill label={rightHeader} value={tr} highlight={tr > tl && tr > 0} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {exportOpen && activeCase && (
        <ExportModal
          caseRow={activeCase}
          consideration={draft}
          recruiterNotes={recruiterNotes}
          newCompany={newCompany}
          currentCompany={currentCompany}
          onClose={() => setExportOpen(false)}
        />
      )}
    </>
  );
}

function TotalPill({ label, value, highlight }: { label: string; value: number; highlight: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "13px 16px",
        borderRadius: "var(--radius-sm)",
        background: highlight ? "var(--green-light)" : "var(--surface-alt)",
        border: "1.5px solid " + (highlight ? "#a7f3d0" : "var(--border)"),
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: highlight ? "var(--green)" : "var(--text-muted)", marginBottom: 4 }}>
        {highlight ? "Higher total package" : " "}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: highlight ? "var(--green)" : "var(--text-primary)" }}>
        {value > 0 ? fmtGbp(value) : "—"}
      </div>
    </div>
  );
}

function NewCaseInline({ onCreated }: { onCreated: (c: CaseRow) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="btn-sec"
        onClick={() => setOpen(true)}
      >
        + New case
      </button>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const r = await fetch("/api/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok && d.case) {
        onCreated(d.case);
        setName("");
        setOpen(false);
      } else {
        alert(d?.error ?? "Could not create case");
      }
    } catch {
      alert("Network error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        className="field-input"
        placeholder="Candidate name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        style={{ width: 180 }}
      />
      <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
        {busy ? "…" : "Add"}
      </button>
      <button type="button" className="btn-sec" onClick={() => { setOpen(false); setName(""); }}>
        Cancel
      </button>
    </form>
  );
}

function FinAdornedInput({
  unit,
  placement,
  value,
  onChange,
}: {
  unit: string;
  placement: "prefix" | "suffix";
  value: string;
  onChange: (v: string) => void;
}) {
  // Show the raw value the user typed; the adornment is purely visual. The
  // parser strips non-numerics regardless, so "£95,000" and "95000" both work,
  // and "6%" in the pension row never bumps the total (Pension is excluded
  // from the currency-only sum).
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      {placement === "prefix" && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 9,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 12,
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        >
          {unit}
        </span>
      )}
      <input
        className="fin-input"
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          paddingLeft: placement === "prefix" ? 20 : undefined,
          paddingRight: placement === "suffix" ? 20 : undefined,
        }}
      />
      {placement === "suffix" && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 9,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 12,
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        >
          {unit}
        </span>
      )}
    </div>
  );
}
