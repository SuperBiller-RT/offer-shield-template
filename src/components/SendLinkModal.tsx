"use client";

import { useEffect, useState } from "react";

interface CaseRow {
  id: string;
  name: string | null;
  new_role: string | null;
}

export default function SendLinkModal({
  caseRow,
  onClose,
}: {
  caseRow: CaseRow;
  onClose: () => void;
}) {
  const [candidateName, setCandidateName] = useState(caseRow.name ?? "");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [roleTitle, setRoleTitle] = useState(caseRow.new_role ?? "");
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function mint(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      const r = await fetch(`/api/cases/${caseRow.id}/share`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_name: candidateName.trim() || null,
          candidate_email: candidateEmail.trim() || null,
          role_title: roleTitle.trim() || null,
          recruiter_email: recruiterEmail.trim() || null,
        }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok && d.url) {
        setResult({ url: d.url });
      } else {
        setErr(d?.error ?? "Could not create the link.");
      }
    } catch {
      setErr("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      alert("Link copied to clipboard.");
    } catch {
      alert("Could not copy. Select and copy manually.");
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ width: 520 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Send link to candidate</div>
            <div className="modal-sub">Candidate completes the form in their own time</div>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {result ? (
            <>
              <div style={{ background: "var(--green-light)", border: "1px solid #a7f3d0", borderRadius: "var(--radius-sm)", padding: "14px 16px", marginBottom: 16, fontSize: 12.5, color: "var(--green)", lineHeight: 1.55 }}>
                Link created. Share it with the candidate via email or message.
              </div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
                Share link
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="field-input"
                  style={{ flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                  readOnly
                  value={result.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="btn-primary" onClick={copyLink}>Copy</button>
              </div>
            </>
          ) : (
            <form onSubmit={mint}>
              <div style={{ background: "var(--accent-light)", border: "1px solid #bfdbfe", borderRadius: "var(--radius-sm)", padding: "12px 14px", marginBottom: 18, fontSize: 12.5, color: "var(--accent)", lineHeight: 1.55 }}>
                A unique link will be generated for this candidate. When they complete and submit their Consideration for Change, you&apos;ll receive an alert.
              </div>
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
                Candidate email
              </label>
              <input
                className="field-input"
                type="email"
                style={{ width: "100%", marginBottom: 14 }}
                placeholder="e.g. james.hartley@example.com"
                value={candidateEmail}
                onChange={(e) => setCandidateEmail(e.target.value)}
              />
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
                Role they&apos;re being considered for
              </label>
              <input
                className="field-input"
                style={{ width: "100%", marginBottom: 14 }}
                placeholder="e.g. Principal Engineer @ Nexus Dynamics"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
              />
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
                Alert recruiter (your email)
              </label>
              <input
                className="field-input"
                type="email"
                style={{ width: "100%", marginBottom: 4 }}
                placeholder="you@example.com"
                value={recruiterEmail}
                onChange={(e) => setRecruiterEmail(e.target.value)}
              />
              {err && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
            </form>
          )}
        </div>
        <div className="modal-footer">
          {result ? (
            <button type="button" className="btn-primary" style={{ marginLeft: "auto" }} onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={mint} disabled={submitting}>
                {submitting ? "Creating…" : "Create link"}
              </button>
              <button type="button" className="btn-sec" onClick={onClose}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
