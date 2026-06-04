"use client";

import { useEffect, useRef, useState } from "react";
import { buildConsiderationPdf, exportConsiderationPdf } from "@/lib/export-consideration";

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

// iOS Safari can't inline-render PDFs in iframes — it forces a navigation
// to the blob URL instead, which exits the modal. Detect and fall back to a
// "tap Download below" note. Other iOS browsers (Chrome, Firefox) use the
// same WebKit engine but expose the same UA pattern, so this is effectively
// "any WebKit-on-iOS" which is the right call: none of them inline PDFs.
function isIosWebkit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua) && /Safari/.test(ua);
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBuilding, setPreviewBuilding] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  // Refs for cleanup + cancellation.
  const previewUrlRef = useRef<string | null>(null);
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rebuildSeqRef = useRef(0);
  const noPreviewInline = useRef<boolean>(false);

  useEffect(() => {
    noPreviewInline.current = isIosWebkit();
  }, []);

  // Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load branding + recruiter name once.
  useEffect(() => {
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

  // Debounced PDF rebuild whenever any input changes.
  useEffect(() => {
    if (noPreviewInline.current) {
      // Skip preview generation entirely on iOS WebKit — preview is the
      // download itself there.
      setPreviewBuilding(false);
      return;
    }
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    setPreviewBuilding(true);
    setPreviewError(null);
    const mySeq = ++rebuildSeqRef.current;
    rebuildTimerRef.current = setTimeout(async () => {
      try {
        const blob = await buildConsiderationPdf({
          caseName: candidateName || caseRow.name || "Candidate",
          recruiterName,
          newCompany,
          currentCompany,
          consideration,
          recruiterNotes,
          branding,
        });
        // Stale-build guard: bail if a newer rebuild has been queued/run.
        if (mySeq !== rebuildSeqRef.current) return;
        const url = URL.createObjectURL(blob);
        // Revoke the previous preview URL.
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewBuilding(false);
      } catch (e) {
        if (mySeq !== rebuildSeqRef.current) return;
        setPreviewError(e instanceof Error ? e.message : "Preview unavailable.");
        setPreviewBuilding(false);
      }
    }, 300);
    return () => {
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    };
  }, [
    candidateName, recruiterName, branding,
    newCompany, currentCompany,
    consideration, recruiterNotes, caseRow.name,
  ]);

  // Unmount cleanup — revoke whatever blob URL is still alive.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  async function download() {
    setDownloadErr(null);
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
      setDownloadErr(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ width: 720, maxWidth: "94vw" }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Export</div>
            <div className="modal-sub">Preview the document, then download a copy to share with the candidate</div>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
                Candidate name
              </label>
              <input
                className="field-input"
                style={{ width: "100%" }}
                placeholder="e.g. James Hartley"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
                Your name
              </label>
              <input
                className="field-input"
                style={{ width: "100%" }}
                placeholder="e.g. Sarah Connell"
                value={recruiterName}
                onChange={(e) => setRecruiterName(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)" }}>
              Preview
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {previewBuilding && !previewError ? "Building…" : ""}
            </div>
          </div>

          {noPreviewInline.current ? (
            <div
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface-alt)",
                borderRadius: "var(--radius)",
                padding: "22px 18px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              In-modal preview isn&apos;t supported on iOS Safari.<br />
              Tap <strong>Download PDF</strong> below to open the document.
            </div>
          ) : previewError ? (
            <div
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface-alt)",
                borderRadius: "var(--radius)",
                padding: "22px 18px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              Preview unavailable on this browser. Use <strong>Download PDF</strong> below to grab the file.
            </div>
          ) : (
            <iframe
              src={previewUrl ?? "about:blank"}
              title="Consideration preview"
              style={{
                width: "100%",
                height: "clamp(320px, 60vh, 600px)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                background: "var(--surface-alt)",
                display: "block",
              }}
            />
          )}

          {downloadErr && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--red)" }}>{downloadErr}</div>
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
