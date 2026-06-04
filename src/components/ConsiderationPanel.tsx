"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportModal from "./ExportModal";
import {
  VALUE_LABELS,
  COMPARISON_FACTORS,
  DEFAULT_FINANCIAL_ROWS,
  hydrateFinancial,
  newRowId,
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencySymbol,
  type FinancialRow,
  type CurrencyCode,
} from "./consideration-constants";

type Verdict = "left" | "right" | "both";

interface Consideration {
  values: number[];
  comparison: Record<string, Verdict>;
  // FinancialRow[] is the canonical shape. Cases written before this change
  // carry a legacy keyed-object — hydrateFinancial() upgrades on load.
  financial: FinancialRow[];
  candidate_reasons: string;
  // Per-case currency. Defaults to GBP for legacy cases. Drives the symbol
  // shown next to currency-unit rows + the total pill.
  currency?: CurrencyCode;
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
  financial: DEFAULT_FINANCIAL_ROWS.map((row) => ({ ...row })),
  candidate_reasons: "",
  currency: DEFAULT_CURRENCY,
};

function parseAmount(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtCurrency(n: number, symbol: string): string {
  return n <= 0 ? "—" : symbol + Math.round(n).toLocaleString("en-GB");
}
function calcTotals(fin: FinancialRow[]) {
  let tl = 0, tr = 0;
  // Currency rows roll up into the Total pill. Percent rows (Pension and any
  // added custom % rows) are shown but excluded — a "6%" entry shouldn't bump
  // the £-total by 6.
  for (const row of fin) {
    if (row.unit !== "currency") continue;
    tl += parseAmount(row.l ?? "");
    tr += parseAmount(row.r ?? "");
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
    // this the echo PATCH on the server's round-trip uses our key-order while
    // the ref was initialised from the server's jsonb shape (Postgres-ordered)
    // and every cycle looks like a real edit (the autosave loops forever).
    // hydrateFinancial also upgrades legacy keyed-object shapes into the new
    // FinancialRow[] in-place.
    const normalised: Consideration = {
      values: cons.values ?? [],
      comparison: cons.comparison ?? {},
      financial: hydrateFinancial(cons.financial),
      candidate_reasons: cons.candidate_reasons ?? "",
      currency: (cons.currency && CURRENCIES.some((c) => c.code === cons.currency))
        ? (cons.currency as CurrencyCode)
        : DEFAULT_CURRENCY,
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

  function updateFinValue(rowId: string, side: "l" | "r", value: string) {
    setDraft((d) => ({
      ...d,
      financial: d.financial.map((row) =>
        row.id === rowId ? { ...row, [side]: value } : row,
      ),
    }));
  }

  function renameFinRow(rowId: string, label: string) {
    setDraft((d) => ({
      ...d,
      financial: d.financial.map((row) =>
        row.id === rowId ? { ...row, label } : row,
      ),
    }));
  }

  function removeFinRow(rowId: string) {
    setDraft((d) => ({
      ...d,
      financial: d.financial.filter((row) => row.id !== rowId || !row.removable),
    }));
  }

  function cycleFinUnit(rowId: string) {
    setDraft((d) => ({
      ...d,
      financial: d.financial.map((row) =>
        row.id === rowId
          ? { ...row, unit: row.unit === "currency" ? "percent" : "currency" }
          : row,
      ),
    }));
  }

  function addFinRow() {
    setDraft((d) => ({
      ...d,
      financial: [
        ...d.financial,
        { id: newRowId(), label: "Custom row", l: "", r: "", unit: "currency", removable: true },
      ],
    }));
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
  const caseCurrency: CurrencyCode = draft.currency ?? DEFAULT_CURRENCY;
  const curSymbol = currencySymbol(caseCurrency);
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
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Financial Comparison</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Full package comparison. Click a row label to rename it, or the unit pill to switch between currency and percent.
                    </div>
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                    Currency
                    <select
                      className="field-input"
                      value={caseCurrency}
                      onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value as CurrencyCode }))}
                      style={{ padding: "5px 8px", fontSize: 12 }}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.symbol} {c.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)", marginTop: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--surface-alt)", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>Item</div>
                    <div style={{ padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--accent)" }}>{leftHeader}</div>
                    <div style={{ padding: "9px 14px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted)" }}>{rightHeader}</div>
                  </div>
                  {draft.financial.map((row) => (
                    <FinancialEditableRow
                      key={row.id}
                      row={row}
                      currencySymbol={curSymbol}
                      onUpdateValue={(side, v) => updateFinValue(row.id, side, v)}
                      onRename={(label) => renameFinRow(row.id, label)}
                      onCycleUnit={() => cycleFinUnit(row.id)}
                      onRemove={() => removeFinRow(row.id)}
                    />
                  ))}
                  {/* Inline add-row affordance — sits inside the table between the
                      data rows and the Total summary, matching Notion/Airtable. */}
                  <button
                    type="button"
                    onClick={addFinRow}
                    style={{
                      width: "100%",
                      padding: "8px 14px",
                      background: "transparent",
                      border: "none",
                      borderTop: "1px dashed var(--border)",
                      borderBottom: "1px solid var(--border-light)",
                      fontFamily: "var(--font)",
                      fontSize: 12,
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "background .12s, color .12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--accent-light)";
                      e.currentTarget.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    + Add row
                  </button>
                  {/* Total row */}
                  {(() => {
                    const lHigh = tl > tr && tl > 0;
                    const rHigh = tr > tl && tr > 0;
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--surface-alt)", borderTop: "2px solid var(--border)" }}>
                        <div style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)" }}>Total Package (est.)</div>
                        <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800, color: lHigh ? "var(--green)" : "var(--text-primary)" }}>{fmtCurrency(tl, curSymbol)}</div>
                        <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800, color: rHigh ? "var(--green)" : "var(--text-primary)" }}>{fmtCurrency(tr, curSymbol)}</div>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                  Total sums currency rows only. Percent rows are shown but excluded from the total.
                </div>
              </div>

              {/* Total summary strip */}
              <div style={{ marginBottom: 20, marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 10 }}>
                  Estimated total annual package
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <TotalPill label={leftHeader} value={tl} symbol={curSymbol} highlight={tl > tr && tl > 0} />
                  <TotalPill label={rightHeader} value={tr} symbol={curSymbol} highlight={tr > tl && tr > 0} />
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

function TotalPill({ label, value, symbol, highlight }: { label: string; value: number; symbol: string; highlight: boolean }) {
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
        {value > 0 ? fmtCurrency(value, symbol) : "—"}
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

function FinancialEditableRow({
  row,
  currencySymbol,
  onUpdateValue,
  onRename,
  onCycleUnit,
  onRemove,
}: {
  row: FinancialRow;
  currencySymbol: string;
  onUpdateValue: (side: "l" | "r", value: string) => void;
  onRename: (label: string) => void;
  onCycleUnit: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const [draftLabel, setDraftLabel] = useState(row.label);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the local draft in sync if the row label changes from elsewhere.
  useEffect(() => { if (!editing) setDraftLabel(row.label); }, [row.label, editing]);

  function commit() {
    const next = draftLabel.trim();
    setEditing(false);
    if (next && next !== row.label) onRename(next);
    else setDraftLabel(row.label);
  }

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--border-light)" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8, minHeight: 34 }}>
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setDraftLabel(row.label); setEditing(false); }
            }}
            style={{
              flex: 1, minWidth: 0, padding: "4px 6px", fontSize: 12.5, fontFamily: "var(--font)",
              border: "1.5px solid var(--accent-mid)", borderRadius: "var(--radius-sm)",
              background: "var(--surface)", color: "var(--text-primary)", outline: "none",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename row"
            style={{
              flex: 1, minWidth: 0, textAlign: "left", padding: "2px 0",
              background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font)",
              fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {row.label}
          </button>
        )}
        <button
          type="button"
          onClick={onCycleUnit}
          title={`Switch between ${currencySymbol} and %`}
          style={{
            padding: "1px 7px", borderRadius: 10,
            background: row.unit === "percent" ? "var(--amber-light)" : "var(--accent-light)",
            color: row.unit === "percent" ? "var(--amber)" : "var(--accent)",
            border: "1px solid " + (row.unit === "percent" ? "#fde68a" : "#bfdbfe"),
            fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)",
            flexShrink: 0,
          }}
        >
          {row.unit === "percent" ? "%" : currencySymbol}
        </button>
        {row.removable && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove row"
            aria-label="Remove row"
            style={{
              width: 18, height: 18, borderRadius: 9,
              background: hover ? "var(--red-light)" : "transparent",
              color: hover ? "var(--red)" : "var(--text-muted)",
              border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font)", flexShrink: 0,
              transition: "background .12s, color .12s",
            }}
          >
            ×
          </button>
        )}
      </div>
      <div style={{ padding: "6px 10px" }}>
        <FinAdornedInput
          unit={row.unit === "percent" ? "%" : currencySymbol}
          placement={row.unit === "percent" ? "suffix" : "prefix"}
          value={row.l}
          onChange={(v) => onUpdateValue("l", v)}
        />
      </div>
      <div style={{ padding: "6px 10px" }}>
        <FinAdornedInput
          unit={row.unit === "percent" ? "%" : currencySymbol}
          placement={row.unit === "percent" ? "suffix" : "prefix"}
          value={row.r}
          onChange={(v) => onUpdateValue("r", v)}
        />
      </div>
    </div>
  );
}
