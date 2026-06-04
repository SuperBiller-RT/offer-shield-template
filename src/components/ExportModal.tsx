"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  // Double-buffered iframe sources: when a new PDF is ready we write it into
  // the inactive slot and only flip `activeSlot` once that iframe fires
  // `onLoad`. The previously-visible iframe stays mounted with its content
  // until the swap, so there's no blank flash between rebuilds.
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null]);
  const [activeSlot, setActiveSlotState] = useState<0 | 1>(0);
  const activeSlotRef = useRef<0 | 1>(0);
  const setActiveSlot = (n: 0 | 1) => { activeSlotRef.current = n; setActiveSlotState(n); };
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBuilding, setPreviewBuilding] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  // Refs for cleanup + cancellation.
  const slotsRef = useRef<[string | null, string | null]>([null, null]);
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

  // Stable rebuild trigger: serialise the dynamic inputs so re-renders with
  // identical content (e.g. autosave round-trip returning a new `consideration`
  // reference with the same shape) don't retrigger the rebuild.
  const rebuildKey = useMemo(() => JSON.stringify({
    candidateName,
    recruiterName,
    newCompany,
    currentCompany,
    recruiterNotes,
    consideration,
    branding,
    fallbackName: caseRow.name,
  }), [candidateName, recruiterName, newCompany, currentCompany, recruiterNotes, consideration, branding, caseRow.name]);

  // Debounced PDF rebuild. Writes into the *inactive* iframe slot — the
  // currently-visible iframe keeps showing its old content until the new
  // iframe finishes loading and onLoad flips `activeSlot`.
  useEffect(() => {
    if (noPreviewInline.current) {
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
        if (mySeq !== rebuildSeqRef.current) return;
        const url = URL.createObjectURL(blob);
        // Write into the inactive slot, revoking whatever was there. Read
        // active slot via ref so this effect doesn't depend on activeSlot
        // state (which would loop: swap → re-run effect → rebuild → swap …).
        const target = activeSlotRef.current === 0 ? 1 : 0;
        setSlots((prev) => {
          const next = [...prev] as [string | null, string | null];
          if (next[target]) URL.revokeObjectURL(next[target]!);
          next[target] = url;
          slotsRef.current = next;
          return next;
        });
        // `activeSlot` flips when the target iframe's onLoad fires.
      } catch (e) {
        if (mySeq !== rebuildSeqRef.current) return;
        setPreviewError(e instanceof Error ? e.message : "Preview unavailable.");
        setPreviewBuilding(false);
      }
    }, 800);
    return () => {
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    };
    // Only rebuildKey drives rebuilds — activeSlot is read via ref so the
    // swap doesn't re-fire this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildKey]);

  // Promote the just-loaded slot. The iframe fires onLoad once when its src
  // first attaches (including the initial `about:blank`) and again every time
  // src changes — we only swap when the loaded slot is the inactive one and
  // it has a real URL.
  function onSlotLoaded(idx: 0 | 1) {
    const slot = slotsRef.current[idx];
    if (!slot) return;
    if (idx === activeSlotRef.current) {
      // Reload of the already-visible slot (rare — e.g. an iframe re-fires
      // onLoad after a re-render). Nothing to swap.
      setPreviewBuilding(false);
      return;
    }
    setActiveSlot(idx);
    setPreviewBuilding(false);
  }

  // Unmount cleanup — revoke whatever blob URLs are still alive.
  useEffect(() => {
    return () => {
      for (const u of slotsRef.current) {
        if (u) URL.revokeObjectURL(u);
      }
      slotsRef.current = [null, null];
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
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "clamp(320px, 60vh, 600px)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                background: "var(--surface-alt)",
                overflow: "hidden",
              }}
            >
              {([0, 1] as const).map((i) => (
                <iframe
                  key={i}
                  src={slots[i] ?? "about:blank"}
                  title={`Consideration preview ${i === 0 ? "A" : "B"}`}
                  onLoad={() => onSlotLoaded(i)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    background: "var(--surface-alt)",
                    opacity: i === activeSlot ? 1 : 0,
                    pointerEvents: i === activeSlot ? "auto" : "none",
                  }}
                />
              ))}
            </div>
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
