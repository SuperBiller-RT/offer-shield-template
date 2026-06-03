"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EXPIRY_BUFFER_MS = 500;
const WATCHDOG_POLL_MS = 60_000;

const CSS = `
.cdp-auth-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0f172a;}
.cdp-auth-overlay.cdp-hidden{display:none;}
.cdp-auth-card{background:#fff;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,0.18),0 4px 12px rgba(0,0,0,0.08);width:100%;max-width:420px;padding:44px 40px 36px;margin:16px;}
.cdp-auth-logo{display:flex;align-items:center;gap:12px;margin-bottom:28px;}
.cdp-auth-logo-mark{width:36px;height:36px;flex-shrink:0;color:#1e40af;}
.cdp-auth-logo-name{font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-.02em;}
.cdp-auth-heading{font-size:20px;font-weight:700;color:#0f172a;margin-bottom:6px;letter-spacing:-.02em;}
.cdp-auth-sub{font-size:13px;color:#64748b;margin-bottom:24px;line-height:1.5;}
.cdp-auth-field{margin-bottom:14px;}
.cdp-auth-field label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:5px;letter-spacing:.01em;}
.cdp-auth-field input{width:100%;border:1.5px solid #e2e8f0;border-radius:7px;padding:10px 13px;font-size:14px;font-family:inherit;color:#0f172a;background:#fff;outline:none;transition:border-color .15s;}
.cdp-auth-field input:focus{border-color:#1e40af;}
.pw-wrap{position:relative;}
.pw-wrap input{padding-right:42px;}
.pw-toggle{position:absolute;top:50%;right:6px;transform:translateY(-50%);background:transparent;border:0;padding:6px;cursor:pointer;color:#64748b;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;}
.pw-toggle:hover{color:#0f172a;background:#f1f5f9;}
.cdp-auth-btn{width:100%;padding:11px;border-radius:7px;background:#1e40af;color:#fff;font-family:inherit;font-size:14px;font-weight:600;border:0;cursor:pointer;letter-spacing:.01em;transition:background .15s;}
.cdp-auth-btn:hover{background:#1d3a9e;}
.cdp-auth-btn:disabled{opacity:.6;cursor:not-allowed;}
.cdp-auth-msg{font-size:12.5px;margin-top:10px;min-height:18px;line-height:1.4;}
.cdp-auth-msg.err{color:#b91c1c;}
.cdp-auth-msg.ok{color:#15803d;}
.cdp-auth-links{text-align:center;margin-top:18px;font-size:12.5px;color:#64748b;line-height:1.5;}
.cdp-auth-link-btn{background:transparent;border:0;color:#1e40af;text-decoration:underline;cursor:pointer;padding:0;font:inherit;font-size:12.5px;}
.cdp-wall{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0f172a;padding:24px;}
.cdp-wall-inner{max-width:480px;text-align:center;}
.cdp-wall-title{font-size:24px;font-weight:700;letter-spacing:-.02em;margin-bottom:12px;}
.cdp-wall-msg{font-size:15px;color:#475569;line-height:1.55;}
`;

interface User {
  id: string;
  email: string;
  display_name: string | null;
}

type WallCode = "ACCESS_EXPIRED" | "NOT_ENTITLED";

const WALL_COPY: Record<WallCode, { title: string; msg: string }> = {
  ACCESS_EXPIRED: {
    title: "Your trial has expired.",
    msg: "Please contact your administrator to renew access.",
  },
  NOT_ENTITLED: {
    title: "No access to this app.",
    msg: "Your account is not entitled to use OfferShield. Please contact your administrator.",
  },
};

let triggerWall: ((code: WallCode) => void) | null = null;
let fetchPatched = false;

function installFetchInterceptor(): void {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await original(...args);
    if (res.status === 403) {
      try {
        const clone = res.clone();
        const ct = clone.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data: { code?: unknown } = await clone.json();
          const code = data && typeof data.code === "string" ? data.code : "";
          if (code === "ACCESS_EXPIRED" || code === "NOT_ENTITLED") {
            triggerWall?.(code);
          }
        }
      } catch {
        // best-effort
      }
    }
    return res;
  };
}

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" className="cdp-auth-logo-mark" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "signedOut" | "signedIn">("loading");
  const [, setUser] = useState<User | null>(null);
  const [wall, setWall] = useState<WallCode | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [panel, setPanel] = useState<"signin" | "recover">("signin");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverKey, setRecoverKey] = useState("");
  const [recoverPw1, setRecoverPw1] = useState("");
  const [recoverPw2, setRecoverPw2] = useState("");
  const [recoverMsg, setRecoverMsg] = useState("");
  const [recoverMsgErr, setRecoverMsgErr] = useState(false);
  const [recoverSubmitting, setRecoverSubmitting] = useState(false);

  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    installFetchInterceptor();
    triggerWall = (code) => {
      if (expiryTimerRef.current) { clearTimeout(expiryTimerRef.current); expiryTimerRef.current = null; }
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      setWall(code);
    };
    return () => { triggerWall = null; };
  }, []);

  const clearWatchdog = useCallback(() => {
    if (expiryTimerRef.current) { clearTimeout(expiryTimerRef.current); expiryTimerRef.current = null; }
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  const armWatchdog = useCallback((meData: { access_expires_at?: string | null }) => {
    clearWatchdog();
    const exp = meData.access_expires_at ? new Date(meData.access_expires_at).getTime() : 0;
    if (exp > 0) {
      const ms = exp - Date.now() + EXPIRY_BUFFER_MS;
      if (ms > 0) {
        expiryTimerRef.current = setTimeout(() => {
          void fetch("/api/auth/me", { credentials: "same-origin" });
        }, ms);
      }
    }
    pollTimerRef.current = setInterval(() => {
      void fetch("/api/auth/me", { credentials: "same-origin" });
    }, WATCHDOG_POLL_MS);
  }, [clearWatchdog]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (r) => {
        if (r.status === 401) return { state: "signedOut" as const };
        if (r.ok) {
          const d = (await r.json().catch(() => null)) as
            | { ok?: boolean; user?: User; access_expires_at?: string | null }
            | null;
          if (d && d.ok && d.user) return { state: "signedIn" as const, data: d };
        }
        return null;
      })
      .then((r) => {
        if (cancelled || !r) return;
        if (r.state === "signedOut") {
          setState("signedOut");
        } else {
          setUser(r.data.user as User);
          setState("signedIn");
          armWatchdog(r.data);
        }
      })
      .catch(() => !cancelled && setState("signedOut"));
    return () => {
      cancelled = true;
      clearWatchdog();
    };
  }, [armWatchdog, clearWatchdog]);

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setRecoverMsg("");
    if (!recoverEmail.trim() || !recoverKey.trim() || !recoverPw1 || !recoverPw2) {
      setRecoverMsgErr(true);
      setRecoverMsg("Fill in every field.");
      return;
    }
    if (recoverPw1.length < 8) {
      setRecoverMsgErr(true);
      setRecoverMsg("New password must be at least 8 characters.");
      return;
    }
    if (recoverPw1 !== recoverPw2) {
      setRecoverMsgErr(true);
      setRecoverMsg("The two new passwords don't match.");
      return;
    }
    setRecoverSubmitting(true);
    try {
      const r = await fetch("/api/auth/reset-with-key", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: recoverEmail.trim(),
          recoveryKey: recoverKey.trim(),
          newPassword: recoverPw1,
        }),
      });
      const d = await r.json().catch(() => ({ ok: false, error: "Invalid response" }));
      if (r.ok && d.ok) {
        setRecoverMsgErr(false);
        setRecoverMsg("Password updated. You can sign in with the new one now.");
        setEmail(recoverEmail.trim());
        setPw("");
        setRecoverKey("");
        setRecoverPw1("");
        setRecoverPw2("");
        setTimeout(() => {
          setPanel("signin");
          setRecoverMsg("");
          setMsgErr(false);
          setMsg("Password updated. Sign in with your new password.");
        }, 1500);
      } else {
        setRecoverMsgErr(true);
        setRecoverMsg(d.error || "Could not reset password");
      }
    } catch {
      setRecoverMsgErr(true);
      setRecoverMsg("Network error");
    } finally {
      setRecoverSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !pw) {
      setMsgErr(true);
      setMsg("Email and password required");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: pw }),
      });
      const d = await r.json().catch(() => ({ ok: false, error: "Invalid response" }));
      if (r.ok && d.ok && d.user) {
        setUser(d.user);
        setState("signedIn");
        armWatchdog(d);
      } else {
        if (r.status !== 403) {
          setMsgErr(true);
          setMsg(d.error || "Sign in failed");
        }
      }
    } catch {
      setMsgErr(true);
      setMsg("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (wall) {
    const copy = WALL_COPY[wall];
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="cdp-wall" role="alert">
          <div className="cdp-wall-inner">
            <div className="cdp-wall-title">{copy.title}</div>
            <div className="cdp-wall-msg">{copy.msg}</div>
          </div>
        </div>
      </>
    );
  }

  if (state === "loading") {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="cdp-auth-overlay" aria-hidden="true" />
      </>
    );
  }

  if (state === "signedOut") {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="cdp-auth-overlay">
          <div className="cdp-auth-card">
            <div className="cdp-auth-logo">
              <ShieldMark />
              <span className="cdp-auth-logo-name">OfferShield</span>
            </div>
            {panel === "signin" ? (
              <>
                <div className="cdp-auth-heading">Sign in</div>
                <div className="cdp-auth-sub">Welcome back. Sign in to continue.</div>
                <form onSubmit={handleSubmit}>
                  <div className="cdp-auth-field">
                    <label htmlFor="cdpLoginEmail">Email</label>
                    <input
                      id="cdpLoginEmail"
                      type="email"
                      autoComplete="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="cdp-auth-field">
                    <label htmlFor="cdpLoginPassword">Password</label>
                    <div className="pw-wrap">
                      <input
                        id="cdpLoginPassword"
                        type={showPw ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Password"
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                      />
                      <button
                        type="button"
                        className="pw-toggle"
                        aria-label={showPw ? "Hide password" : "Show password"}
                        onClick={() => setShowPw((s) => !s)}
                      >
                        {showPw ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 3l18 18" />
                            <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a17.4 17.4 0 0 1-3.2 4.1" />
                            <path d="M6.6 6.6A17.5 17.5 0 0 0 2 12s3.5 6 10 6a10.7 10.7 0 0 0 4.6-1.1" />
                            <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <button type="submit" className="cdp-auth-btn" disabled={submitting}>
                    {submitting ? "Signing in…" : "Sign in"}
                  </button>
                  <div className={"cdp-auth-msg" + (msg ? (msgErr ? " err" : " ok") : "")}>{msg}</div>
                </form>
                <div className="cdp-auth-links">
                  <button
                    type="button"
                    className="cdp-auth-link-btn"
                    onClick={() => { setPanel("recover"); setMsg(""); setRecoverMsg(""); }}
                  >
                    Forgot password? Reset with serial key
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="cdp-auth-heading">Reset password</div>
                <div className="cdp-auth-sub">Enter your email, the serial key your admin shipped to you, and a new password.</div>
                <form onSubmit={handleRecover}>
                  <div className="cdp-auth-field">
                    <label htmlFor="cdpRecoverEmail">Email</label>
                    <input
                      id="cdpRecoverEmail"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={recoverEmail}
                      onChange={(e) => setRecoverEmail(e.target.value)}
                    />
                  </div>
                  <div className="cdp-auth-field">
                    <label htmlFor="cdpRecoverKey">Serial key</label>
                    <input
                      id="cdpRecoverKey"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="ABCD-1234-EF56-7890"
                      value={recoverKey}
                      onChange={(e) => setRecoverKey(e.target.value)}
                      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.05em" }}
                    />
                  </div>
                  <div className="cdp-auth-field">
                    <label htmlFor="cdpRecoverPw1">New password</label>
                    <input
                      id="cdpRecoverPw1"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Minimum 8 characters"
                      value={recoverPw1}
                      onChange={(e) => setRecoverPw1(e.target.value)}
                    />
                  </div>
                  <div className="cdp-auth-field">
                    <label htmlFor="cdpRecoverPw2">Confirm new password</label>
                    <input
                      id="cdpRecoverPw2"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Type it again"
                      value={recoverPw2}
                      onChange={(e) => setRecoverPw2(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="cdp-auth-btn" disabled={recoverSubmitting}>
                    {recoverSubmitting ? "Resetting…" : "Reset password"}
                  </button>
                  <div className={"cdp-auth-msg" + (recoverMsg ? (recoverMsgErr ? " err" : " ok") : "")}>{recoverMsg}</div>
                </form>
                <div className="cdp-auth-links">
                  <button
                    type="button"
                    className="cdp-auth-link-btn"
                    onClick={() => { setPanel("signin"); setRecoverMsg(""); }}
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
