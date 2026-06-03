"use client";

import { useEffect, useMemo, useState } from "react";
import { VALUE_LABELS, COMPARISON_FACTORS } from "./consideration-constants";

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

function parseGbp(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtGbp(n: number): string {
  return n <= 0 ? "—" : "£" + Math.round(n).toLocaleString("en-GB");
}

export default function SendSummaryModal({
  caseRow,
  consideration,
  recruiterNotes,
  onClose,
}: {
  caseRow: CaseRow;
  consideration: Consideration;
  recruiterNotes: string;
  onClose: () => void;
}) {
  const [candidateName, setCandidateName] = useState(caseRow.name ?? "");
  const [recruiterName, setRecruiterName] = useState("");

  useEffect(() => {
    // Esc closes
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totals = useMemo(() => {
    let tl = 0, tr = 0;
    for (let i = 0; i < 7; i++) {
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
    else if (v === "both") { leftScore += 0.5; rightScore += 0.5; }
  }

  const previewText = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Summary for ${candidateName || caseRow.name || "candidate"}`);
    if (recruiterName) lines.push(`Prepared by ${recruiterName}`);
    lines.push("");
    if (caseRow.new_role) lines.push(`Considering: ${caseRow.new_role}`);
    if (caseRow.current_role) lines.push(`Current: ${caseRow.current_role}`);
    lines.push("");
    if (consideration.values.length > 0) {
      lines.push("What matters to you in your work:");
      consideration.values.forEach((i) => lines.push("  • " + VALUE_LABELS[i]));
      lines.push("");
    }
    if (consideration.candidate_reasons.trim()) {
      lines.push("Your reasons for making this move:");
      lines.push(consideration.candidate_reasons.trim());
      lines.push("");
    }
    if (Object.keys(consideration.comparison).length > 0) {
      lines.push(`Role comparison: ${Math.floor(leftScore)} factor(s) favour new role, ${Math.floor(rightScore)} favour current.`);
      lines.push("");
    }
    if (totals.tl > 0 || totals.tr > 0) {
      lines.push(`Total annual package — new role: ${fmtGbp(totals.tl)} · current: ${fmtGbp(totals.tr)}`);
      lines.push("");
    }
    if (recruiterNotes.trim()) {
      lines.push("Recruiter notes:");
      lines.push(recruiterNotes.trim());
    }
    return lines.join("\n");
  }, [candidateName, recruiterName, caseRow, consideration, recruiterNotes, leftScore, rightScore, totals]);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(previewText);
      alert("Copied to clipboard.");
    } catch {
      alert("Could not copy — select and copy manually.");
    }
  }

  function printPreview() {
    const w = window.open("", "_blank");
    if (!w) return;
    const safe = previewText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    w.document.write(`<!doctype html><html><head><title>${candidateName || "summary"}</title><style>body{font-family:Inter,system-ui,sans-serif;padding:32px;max-width:680px;margin:0 auto;color:#111827;line-height:1.55;font-size:13px;}pre{white-space:pre-wrap;font-family:inherit;}</style></head><body><pre>${safe}</pre></body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ width: 600 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Send summary to candidate</div>
            <div className="modal-sub">Use this when you&apos;ve completed the session together on a call</div>
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
            Sent by (your name)
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
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={copyToClipboard}>
            Copy to clipboard
          </button>
          <button type="button" className="btn-sec" style={{ flex: 1 }} onClick={printPreview}>
            Print / Save PDF
          </button>
          <button type="button" className="btn-sec" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
