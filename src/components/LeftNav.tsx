"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/consideration",
    label: "Consideration for Change",
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="8" height="16" rx="1.5" />
        <rect x="13" y="4" width="8" height="16" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .35 1.86l.07.06a2 2 0 1 1-2.83 2.83l-.06-.07A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.86.35l-.06.07a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.35-1.86l-.07-.06A2 2 0 1 1 7 4.25l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.86-.35l.06-.07a2 2 0 1 1 2.83 2.83l-.07.06A1.7 1.7 0 0 0 19.4 9c.18.39.59.65 1 .6h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1Z" />
      </svg>
    ),
  },
];

export default function LeftNav({
  mobileOpen,
  onNavigate,
}: {
  mobileOpen: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <aside className={"left-nav" + (mobileOpen ? " open" : "")} aria-label="Sections">
      {ITEMS.map((item) => {
        const active = pathname === item.href || (item.href !== "/consideration" && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={"nav-btn" + (active ? " active" : "")}
            onClick={onNavigate}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
