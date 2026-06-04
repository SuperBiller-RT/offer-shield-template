"use client";

import { useEffect, useMemo, useState } from "react";
import { VALUE_LABELS, COMPARISON_FACTORS } from "./consideration-constants";
import { exportConsiderationPdf } from "@/lib/export-consideration";

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
  current_role: string | null;
  new_role: string | null;
}

interface Branding {
  banner?: string;
  bannerHeight?: number;
  companyName?: string;
  footer?: string;
}

function parseGbp(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtGbp(n: number): string {
  return n <= 0 ? "—" : "£" + Math.round(n).toLocaleString("en-GB");
}

export default function ExportModal({
  caseRow,
  consideration,
  recruiterNotes,
  newCompany,
  currentCompany,
  onClose,
}: {
  caseRow: CaseRow;
  consideration: Consideration;
  recruiterNotes: string;
  newCompany: string;
  currentCompany: string;
  onClose: () => void;
}) {
  const [candidateName, setCandidateName] = useState(caseRow.name ?? "");
  const [recruiterName, setRecruiterName] = useState("");
  const [branding, setBranding] = useState<Branding>({});
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Pull the recruiter's saved branding + their display name so the PDF can
    // use the banner + agency name + footer + a default recruiterName.
    // Best-effort: an empty response still produces a valid (unbranded) PDF.
    let cancelled = false;
    Promise.all([
      fetch("/api/auth/branding", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/auth/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([brand, me]) => {
      if (cancelled) return;
      if (brand?.ok) {
        const b = brand.branding ?? brand;
        setBranding(b as Branding);
      }
      const name = me?.user?.display_name;
      if (typeof name === "string" && name.trim()) {
        setRecruiterName((prev) => prev || name.trim());
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => {
    const FIN_CURRENCY_INDICES = [0, 1, 2, 3, 5, 6];
    let tl = 0, tr = 0;
    for (const i of FIN_CURRENCY_INDICES) {
      const row = consideration.financial[String(i)];
      if (row) {
        tl += parseGbp(row.l ?? "");
        tr += parseGbp(row.r ?? "");
      }
    }
    return { tl, tr };
  }, [consideration.financial]);

  let leftScore = 0, rightScore = 0;
  for (let i = 0; i < COMPARISON_FACTORS.length; i++) {
    const v = consideration.comparison[String(i)];
    if (v === "left") leftScore++;
    else if (v === "right") rightScore++;
    else if (v === "both") { leftScore++; rightScore++; }
  }

  const previewText = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Consideration for Change — ${candidateName || caseRow.name || "candidate"}`);
    if (recruiterName) lines.push(`Prepared by ${recruiterName}`);
    if (branding.companyName) lines.push(branding.companyName);
    lines.push("");
    if (newCompany) lines.push(`Considering: ${newCompany}`);
    if (currentCompany) lines.push(`Current: ${currentCompany}`);
    lines.push("");
    if (consideration.candidate_reasons.trim()) {
      lines.push("YOUR REASONS FOR MAKING THIS MOVE");
      lines.push(`"${consideration.candidate_reasons.trim()}"`);
      lines.push("");
    }
    if (consideration.values.length > 0) {
      lines.push("WHAT MATTERS TO YOU IN YOUR WORK");
      consideration.values.forEach((i) => lines.push("  • " + VALUE_LABELS[i]));
      lines.push("");
    }
    if (Object.keys(consideration.comparison).length > 0) {
      lines.push(`ROLE COMPARISON — ${leftScore} factor(s) favour ${newCompany || "new"}, ${rightScore} favour ${currentCompany || "current"}.`);
      lines.push("");
    }
    if (totals.tl > 0 || totals.tr > 0) {
      lines.push(`TOTAL ANNUAL PACKAGE — ${newCompany || "new"}: ${fmtGbp(totals.tl)}  ·  ${currentCompany || "current"}: ${fmtGbp(totals.tr)}`);
      lines.push("");
    }
    if (recruiterNotes.trim()) {
      lines.push("RECRUITER NOTES");
      lines.push(recruiterNotes.trim());
    }
    return lines.join("\n");
  }, [candidateName, recruiterName, branding, newCompany, currentCompany, caseRow, consideration, recruiterNotes, leftScore, rightScore, totals]);

  async function download() {
    setErr(null);
    setExporting(true);
    try {
      await exportConsiderationPdf({
        caseName: candidateName || caseRow.name || "Candidate",
        recruiterName,
        newCompany,
        currentCompany,
        consideration,
        recruiterNotes,
        branding,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ width: 600 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Export</div>
            <div className="modal-sub">Download a formatted PDF of the consideration to share with the candidate</div>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
            Candidate name
          </label>
          <input
            className="field-input"
            style={{ width: "100%", marginBottom: 14 }}
            placeholder="e.g. James Hartley"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
          />
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
            Your name (appears on the document)
          </label>
          <input
            className="field-input"
            style={{ width: "100%", marginBottom: 18 }}
            placeholder="e.g. Sarah Connell"
            value={recruiterName}
            onChange={(e) => setRecruiterName(e.target.value)}
          />
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 8 }}>
            Preview
          </div>
          <pre
            style={{
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "16px 18px",
              maxHeight: 280,
              overflowY: "auto",
              fontSize: 12,
              fontFamily: "inherit",
              whiteSpace: "pre-wrap",
              lineHeight: 1.55,
              color: "var(--text-secondary)",
            }}
          >
            {previewText}
          </pre>
          {err && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--red)" }}>{err}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
            The PDF uses your saved banner + agency name from Settings.
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={download} disabled={exporting}>
            {exporting ? "Building PDF…" : "Download PDF"}
          </button>
          <button type="button" className="btn-sec" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
