"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODEL_OPTIONS, DEFAULT_MODEL, formatModelOption } from "@/lib/openrouter-models";

interface Me {
  ok: boolean;
  user: {
    id: string;
    email: string;
    display_name: string | null;
    is_admin: boolean;
    account_type: string | null;
    effective_permissions?: {
      canInsertKeys: boolean;
      canSeeBalance: boolean;
    };
  };
}

interface AiSettings {
  hasKey: boolean;
  keyHint: string;
  model: string;
}

interface Branding {
  banner: string;
  bannerHeight: number;
  companyName: string;
  footer: string;
  bannerScale: number | null;
  bannerOffsetX: number | null;
  bannerOffsetY: number | null;
  bannerFrameWidth: number | null;
}

const DEFAULT_BRAND: Branding = {
  banner: "",
  bannerHeight: 96,
  companyName: "",
  footer: "",
  bannerScale: null,
  bannerOffsetX: null,
  bannerOffsetY: null,
  bannerFrameWidth: null,
};

const HEIGHT_PRESETS = [
  { label: "Short", value: 64 },
  { label: "Medium", value: 96 },
  { label: "Tall", value: 128 },
  { label: "Hero", value: 192 },
];

const MAX_BANNER_DIMENSION = 1600;

// Downscale a chosen image to ~1600px max width via canvas + return data URL.
async function downscaleImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const ratio = Math.min(1, MAX_BANNER_DIMENSION / Math.max(img.naturalWidth, 1));
    const w = Math.round(img.naturalWidth * ratio);
    const h = Math.round(img.naturalHeight * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    const mime = file.type.includes("png") ? "image/png" : "image/jpeg";
    return canvas.toDataURL(mime, mime === "image/jpeg" ? 0.92 : undefined);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function SettingsPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // ── AI Keys ──
  const [ai, setAi] = useState<AiSettings>({ hasKey: false, keyHint: "", model: "" });
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [balance, setBalance] = useState<{ remaining: number; spent: number } | null>(null);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);

  // ── Branding ──
  const [brand, setBrand] = useState<Branding>(DEFAULT_BRAND);
  const [rawBanner, setRawBanner] = useState<string>(""); // working copy
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandMsg, setBrandMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const bannerFileRef = useRef<HTMLInputElement | null>(null);

  const canManageKeys = !!me?.user?.effective_permissions?.canInsertKeys;
  const canSeeBalance = !!me?.user?.effective_permissions?.canSeeBalance;

  // Debounced autosave for the model picker. Key save stays explicit (Save
  // button) because the input is masked + user-typed; model is a single-click
  // dropdown so autosave matches rspy's UX.
  const modelSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modelSaveStatus, setModelSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const saveModel = useCallback(async (next: string) => {
    setModelSaveStatus("saving");
    try {
      const r = await fetch("/api/auth/ai-settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok) {
        setModelSaveStatus("saved");
        setTimeout(() => setModelSaveStatus("idle"), 1500);
      } else {
        setModelSaveStatus("error");
      }
    } catch {
      setModelSaveStatus("error");
    }
  }, []);

  function onModelChange(next: string) {
    setAi((a) => ({ ...a, model: next }));
    if (modelSaveTimerRef.current) clearTimeout(modelSaveTimerRef.current);
    modelSaveTimerRef.current = setTimeout(() => { void saveModel(next); }, 350);
  }

  // Load me + ai-settings + branding on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/auth/me", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null),
      fetch("/api/auth/ai-settings", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null),
      fetch("/api/auth/branding", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null),
    ]).then(([meData, aiData, brandData]) => {
      if (cancelled) return;
      if (meData?.ok) setMe(meData as Me);
      if (aiData?.ok) {
        setAi({
          hasKey: !!aiData.hasKey,
          keyHint: typeof aiData.keyHint === "string" ? aiData.keyHint : "",
          model: typeof aiData.model === "string" ? aiData.model : "",
        });
      }
      if (brandData?.ok && brandData.branding) {
        const b = brandData.branding as Partial<Branding>;
        const merged: Branding = { ...DEFAULT_BRAND, ...b };
        setBrand(merged);
        setRawBanner(merged.banner || "");
      }
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Load balance once we know the user can see it.
  useEffect(() => {
    if (!canSeeBalance || !ai.hasKey) return;
    let cancelled = false;
    fetch("/api/auth/openrouter-balance", { credentials: "same-origin" })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (cancelled) return;
        if (d?.ok) {
          setBalance({ remaining: Number(d.remaining ?? 0), spent: Number(d.spent ?? 0) });
        } else {
          setBalanceErr(d?.error ?? "Could not load balance.");
        }
      })
      .catch(() => !cancelled && setBalanceErr("Network error fetching balance."));
    return () => { cancelled = true; };
  }, [canSeeBalance, ai.hasKey]);

  // ── AI key handlers ──
  async function saveAiKey() {
    if (!canManageKeys) return;
    const key = aiKeyInput.trim();
    if (!key) {
      setAiMsg({ kind: "err", text: "Paste an OpenRouter key first." });
      return;
    }
    setAiBusy(true);
    setAiMsg(null);
    try {
      const r = await fetch("/api/auth/ai-settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok) {
        setAi({ hasKey: !!d.hasKey, keyHint: d.keyHint ?? "", model: d.model ?? ai.model });
        setAiKeyInput("");
        setAiMsg({ kind: "ok", text: "Key saved." });
        setBalance(null);
        setBalanceErr(null);
      } else {
        setAiMsg({ kind: "err", text: d?.error ?? "Could not save key." });
      }
    } catch {
      setAiMsg({ kind: "err", text: "Network error" });
    } finally {
      setAiBusy(false);
    }
  }

  async function clearAiKey() {
    if (!canManageKeys) return;
    if (!confirm("Remove the saved OpenRouter key?")) return;
    setAiBusy(true);
    setAiMsg(null);
    try {
      const r = await fetch("/api/auth/ai-settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "" }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok) {
        setAi({ hasKey: false, keyHint: "", model: ai.model });
        setAiMsg({ kind: "ok", text: "Key cleared." });
        setBalance(null);
        setBalanceErr(null);
      } else {
        setAiMsg({ kind: "err", text: d?.error ?? "Could not clear key." });
      }
    } catch {
      setAiMsg({ kind: "err", text: "Network error" });
    } finally {
      setAiBusy(false);
    }
  }

  // ── Branding handlers ──
  async function onBannerFile(f: File) {
    setBrandMsg(null);
    try {
      const dataUrl = await downscaleImage(f);
      setRawBanner(dataUrl);
      setBrand((b) => ({
        ...b,
        banner: dataUrl,
        bannerScale: 1,
        bannerOffsetX: 0,
        bannerOffsetY: 0,
        bannerFrameWidth: null,
      }));
    } catch {
      setBrandMsg({ kind: "err", text: "Could not read that image." });
    }
  }

  function removeBanner() {
    setRawBanner("");
    setBrand((b) => ({
      ...b,
      banner: "",
      bannerScale: null,
      bannerOffsetX: null,
      bannerOffsetY: null,
      bannerFrameWidth: null,
    }));
  }

  async function saveBranding() {
    setBrandBusy(true);
    setBrandMsg(null);
    try {
      const r = await fetch("/api/auth/branding", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banner: rawBanner,
          bannerHeight: brand.bannerHeight,
          bannerScale: brand.bannerScale,
          bannerOffsetX: brand.bannerOffsetX,
          bannerOffsetY: brand.bannerOffsetY,
          bannerFrameWidth: brand.bannerFrameWidth,
          companyName: brand.companyName,
          footer: brand.footer,
        }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.ok) {
        setBrandMsg({ kind: "ok", text: "Branding saved." });
      } else {
        setBrandMsg({ kind: "err", text: d?.error ?? "Could not save branding." });
      }
    } catch {
      setBrandMsg({ kind: "err", text: "Network error" });
    } finally {
      setBrandBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="scroll-wrap">
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  const accountLabel =
    me?.user.is_admin ? "Administrator" :
      me?.user.account_type === "member" ? "Member" :
        me?.user.account_type === "trial" ? "Trial" : "User";

  return (
    <div className="scroll-wrap">
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 3 }}>Settings</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 24 }}>
          Connect OfferShield to your key, set your brand, and manage your account.
        </div>

        {/* ── API KEYS ── */}
        <div className="s-section-title">API Keys</div>
        <div className="settings-card">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <div>
              <h3>OpenRouter</h3>
              <div className="desc" style={{ marginBottom: 0 }}>
                {canManageKeys
                  ? "Paste your OpenRouter API key. Used for any future AI features."
                  : "Trial accounts use a shared OpenRouter key. Ask your administrator to upgrade you to a member to manage your own key."}
              </div>
            </div>
            <span className={"status-pill " + (ai.hasKey ? "on" : "off")}>
              {ai.hasKey ? `Connected${ai.keyHint ? ` · …${ai.keyHint}` : ""}` : "Not configured"}
            </span>
          </div>

          {canManageKeys && (
            <>
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <input
                  className="field-input"
                  style={{ flex: 1, minWidth: 220, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                  type="password"
                  autoComplete="off"
                  placeholder={ai.hasKey ? "Paste a new key to replace" : "sk-or-v1-…"}
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                />
                <button type="button" className="btn-primary" onClick={saveAiKey} disabled={aiBusy || !aiKeyInput.trim()}>
                  {aiBusy ? "…" : "Save"}
                </button>
                {ai.hasKey && (
                  <button type="button" className="btn-sec" onClick={clearAiKey} disabled={aiBusy}>
                    Clear
                  </button>
                )}
              </div>
              {aiMsg && (
                <div style={{ marginTop: 10, fontSize: 12, color: aiMsg.kind === "err" ? "var(--red)" : "var(--green)" }}>
                  {aiMsg.text}
                </div>
              )}

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-light)" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 6 }}>
                  Model
                </label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    className="field-input"
                    style={{ flex: 1, minWidth: 280, padding: "8px 10px" }}
                    value={ai.model || DEFAULT_MODEL}
                    onChange={(e) => onModelChange(e.target.value)}
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>{formatModelOption(m)}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: modelSaveStatus === "error" ? "var(--red)" : "var(--text-muted)", minWidth: 60 }}>
                    {modelSaveStatus === "saving" ? "Saving…" :
                      modelSaveStatus === "saved" ? "Saved" :
                        modelSaveStatus === "error" ? "Save failed" : ""}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                  Picked for any AI features added later — no LLM calls in this round.
                </div>
              </div>
            </>
          )}

          {canSeeBalance && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-light)", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
              {balance ? (
                <>
                  <span><strong style={{ color: "var(--text-primary)" }}>Remaining:</strong> ${balance.remaining.toFixed(2)}</span>
                  <span><strong style={{ color: "var(--text-primary)" }}>Spent:</strong> ${balance.spent.toFixed(2)}</span>
                </>
              ) : balanceErr ? (
                <span style={{ color: "var(--amber)" }}>{balanceErr}</span>
              ) : ai.hasKey ? (
                <span style={{ color: "var(--text-muted)" }}>Loading balance…</span>
              ) : null}
            </div>
          )}
        </div>

        {/* ── BRANDING ── */}
        <div className="s-section-title" style={{ marginTop: 24 }}>Branding</div>
        <div className="settings-card">
          <h3>Banner + company details</h3>
          <div className="desc">
            Upload a banner, drag and zoom to crop, then save. The cropped strip appears on the top-nav and on shared summaries.
          </div>

          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 8 }}>
            Banner
          </label>
          {rawBanner ? (
            <BannerCropEditor
              src={rawBanner}
              height={brand.bannerHeight}
              scale={brand.bannerScale ?? 1}
              offsetX={brand.bannerOffsetX ?? 0}
              offsetY={brand.bannerOffsetY ?? 0}
              frameWidth={brand.bannerFrameWidth}
              onChange={(patch) => setBrand((b) => ({ ...b, ...patch }))}
              onReplace={() => bannerFileRef.current?.click()}
              onRemove={removeBanner}
            />
          ) : (
            <BannerDropzone fileRef={bannerFileRef} onFile={onBannerFile} />
          )}
          <input
            ref={bannerFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onBannerFile(f);
            }}
            style={{ display: "none" }}
          />

          {rawBanner && (
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 16px", fontSize: 12 }}>
              <div style={{ alignSelf: "center", color: "var(--text-muted)" }}>Frame height</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                  {HEIGHT_PRESETS.map((p) => {
                    const on = brand.bannerHeight === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setBrand((b) => ({ ...b, bannerHeight: p.value }))}
                        style={{
                          padding: "4px 11px",
                          fontSize: 11.5,
                          fontWeight: 600,
                          background: on ? "var(--accent)" : "var(--surface)",
                          color: on ? "#fff" : "var(--text-secondary)",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "var(--font)",
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="range"
                  min={40}
                  max={300}
                  step={2}
                  value={brand.bannerHeight}
                  onChange={(e) => setBrand((b) => ({ ...b, bannerHeight: Number(e.target.value) }))}
                  style={{ flex: 1, minWidth: 120 }}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)", width: 44, textAlign: "right" }}>
                  {brand.bannerHeight}px
                </span>
              </div>
            </div>
          )}

          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 8, marginTop: 18 }}>
            Company name
          </label>
          <input
            type="text"
            maxLength={120}
            className="field-input"
            style={{ width: "100%", padding: "9px 12px" }}
            placeholder="e.g. Talent Intelligence by Acme"
            value={brand.companyName}
            onChange={(e) => setBrand((b) => ({ ...b, companyName: e.target.value }))}
          />

          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 8, marginTop: 16 }}>
            Footer line
          </label>
          <input
            type="text"
            maxLength={240}
            className="field-input"
            style={{ width: "100%", padding: "9px 12px" }}
            placeholder="e.g. acme.com · +44 20 1234 5678"
            value={brand.footer}
            onChange={(e) => setBrand((b) => ({ ...b, footer: e.target.value }))}
          />

          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--text-muted)", marginBottom: 8, marginTop: 18 }}>
            Live preview
          </label>
          <BrandingPreview branding={{ ...brand, banner: rawBanner || brand.banner }} />

          {brandMsg && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: brandMsg.kind === "err" ? "var(--red)" : "var(--green)" }}>
              {brandMsg.text}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-light)" }}>
            <button type="button" className="btn-primary" onClick={saveBranding} disabled={brandBusy}>
              {brandBusy ? "Saving…" : "Save branding"}
            </button>
          </div>
        </div>

        {/* ── ACCOUNT ── */}
        <div className="s-section-title" style={{ marginTop: 24 }}>Account</div>
        <div className="settings-card">
          <h3>{me?.user.display_name || me?.user.email || "Account"}</h3>
          <div className="desc" style={{ marginBottom: 6 }}>
            {me?.user.email} · {accountLabel}
          </div>
          <button
            type="button"
            className="btn-sec"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function BannerDropzone({
  fileRef,
  onFile,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{
        border: "1.5px dashed " + (drag ? "var(--accent)" : "var(--border)"),
        background: drag ? "var(--accent-light)" : "var(--surface)",
        borderRadius: "var(--radius)",
        padding: "20px 22px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 14,
        transition: "all .15s",
      }}
    >
      <div style={{ width: 40, height: 40, background: "var(--accent-light)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Click or drop a banner image here</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          PNG, JPEG, WebP or SVG — automatically downscaled to ~1600px wide.
        </div>
      </div>
    </div>
  );
}

function BannerCropEditor({
  src,
  height,
  scale,
  offsetX,
  offsetY,
  frameWidth,
  onChange,
  onReplace,
  onRemove,
}: {
  src: string;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  frameWidth: number | null;
  onChange: (patch: Partial<Branding>) => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  const onDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, baseX: offsetX, baseY: offsetY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offsetX, offsetY]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d?.dragging) return;
    onChange({
      bannerOffsetX: d.baseX + (e.clientX - d.startX),
      bannerOffsetY: d.baseY + (e.clientY - d.startY),
    });
  }, [onChange]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) dragRef.current.dragging = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const fitToFrame = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || !natural) return;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const fit = Math.max(fw / natural.w, fh / natural.h);
    onChange({ bannerScale: fit, bannerOffsetX: 0, bannerOffsetY: 0 });
  }, [natural, onChange]);

  return (
    <div>
      <div
        ref={frameRef}
        style={{
          position: "relative",
          width: frameWidth ? frameWidth + "px" : "100%",
          maxWidth: "100%",
          height: height + "px",
          overflow: "hidden",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--surface-alt)",
          cursor: "grab",
          touchAction: "none",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt="Banner"
          draggable={false}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale})`,
            transformOrigin: "center center",
            maxWidth: "none",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, fontSize: 12 }}>
        <label style={{ color: "var(--text-muted)" }}>Zoom</label>
        <input
          type="range"
          min={0.3}
          max={4}
          step={0.01}
          value={scale}
          onChange={(e) => onChange({ bannerScale: Number(e.target.value) })}
          style={{ flex: 1, minWidth: 160 }}
        />
        <span style={{ width: 44, textAlign: "right", color: "var(--text-muted)" }}>
          {(scale * 100).toFixed(0)}%
        </span>
        <button
          type="button"
          className="btn-sec"
          style={{ fontSize: 11.5, padding: "4px 10px" }}
          onClick={fitToFrame}
          title="Scale the image so it covers the frame on both axes"
        >
          Fit to frame
        </button>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12 }}>
        <button type="button" className="btn-sec" style={{ fontSize: 11.5, padding: "4px 10px" }} onClick={onReplace}>
          Replace image
        </button>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: "transparent", border: "none", color: "var(--red)", cursor: "pointer", fontFamily: "var(--font)", fontSize: 12.5, textDecoration: "underline" }}
        >
          Remove banner
        </button>
      </div>
    </div>
  );
}

function BrandingPreview({ branding }: { branding: Branding }) {
  const { banner, bannerHeight, bannerScale, bannerOffsetX, bannerOffsetY, companyName, footer } = branding;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
      <div
        style={{
          width: "100%",
          height: bannerHeight + "px",
          background: banner ? "transparent" : "var(--surface-alt)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner}
            alt={companyName || "banner"}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + ${bannerOffsetX ?? 0}px), calc(-50% + ${bannerOffsetY ?? 0}px)) scale(${bannerScale ?? 1})`,
              transformOrigin: "center center",
              maxWidth: "none",
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {companyName || "Banner preview — upload an image above"}
          </span>
        )}
      </div>
      <div style={{ padding: "12px 16px", background: "var(--surface)", borderTop: "1px solid var(--border-light)" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{companyName || "OfferShield"}</div>
        {footer && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{footer}</div>}
      </div>
    </div>
  );
}
