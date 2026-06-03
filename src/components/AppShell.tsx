"use client";

import { useState } from "react";
import Header from "./Header";
import LeftNav from "./LeftNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <Header
        mobileNavOpen={mobileNavOpen}
        onToggleNav={() => setMobileNavOpen((o) => !o)}
      />
      <div className="shell">
        <div
          className={"os-overlay" + (mobileNavOpen ? " on" : "")}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
        <LeftNav
          mobileOpen={mobileNavOpen}
          onNavigate={() => setMobileNavOpen(false)}
        />
        <main className="content-area">{children}</main>
      </div>
    </>
  );
}
