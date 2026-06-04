"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

interface Branding {
  banner: string;
  bannerHeight: number;
  companyName: string;
}

const PAGE_TITLES: Record<string, string> = {
  "/consideration": "Consideration for Change",
  "/settings": "Settings",
};

export default function Header({
  mobileNavOpen,
  onToggleNav,
}: {
  mobileNavOpen: boolean;
  onToggleNav: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [branding, setBranding] = useState<Branding | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/branding", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.ok) return;
        // The API spreads the branding fields directly into the response
        // (`{ ok, banner, bannerHeight, ... }`) — handle both flat and the
        // older `{ ok, branding: {...} }` shape for safety.
        const b = d.branding ?? d;
        setBranding(b as Branding);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      // ignore — still bounce to the login overlay
    } finally {
      window.location.reload();
    }
  }

  const pageTitle = PAGE_TITLES[pathname ?? ""] ?? "";
  const companyName = branding?.companyName?.trim();

  return (
    <nav id="os-topnav" aria-label="Top navigation">
      <button
        id="os-hamburger"
        className={mobileNavOpen ? "open" : ""}
        aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileNavOpen}
        onClick={onToggleNav}
      >
        <span />
        <span />
        <span />
      </button>
      <button
        id="os-nav-brand"
        type="button"
        onClick={() => router.push("/consideration")}
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        {branding?.banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.banner} alt={companyName || "OfferShield"} />
        ) : (
          <ShieldMark />
        )}
        <span id="os-brand-name">{companyName || "OfferShield"}</span>
        {!companyName && <span id="os-brand-sub">· counteroffer toolkit</span>}
      </button>
      <div id="os-pagetitle">{pageTitle}</div>
      <button id="os-signout" type="button" onClick={handleSignOut} disabled={signingOut}>
        {signingOut ? "…" : "Sign out"}
      </button>
    </nav>
  );
}

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
