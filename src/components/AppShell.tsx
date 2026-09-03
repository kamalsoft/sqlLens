"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Overview", icon: "◫" },
  { href: "/review", label: "Review SP", icon: "▣" },
  { href: "/execute", label: "Execute", icon: "▶" },
  { href: "/compare", label: "Compare", icon: "⇄" },
  { href: "/settings", label: "Settings", icon: "⚙" },
  { href: "/manage-models", label: "Models", icon: "◎" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <div className="app-layout">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">S</div>
            <div>
              <h1 className="brand-name">SQLLens</h1>
            </div>
          </div>

          <nav className="nav" aria-label="Sidebar navigation">
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${isActive ? "active" : ""}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="panel panel-card compact-panel">
              <div className="page-kicker">Status</div>
              <div className="status-inline">
                <span className="live-dot" />
                Models online
              </div>
            </div>
          </div>
        </aside>

        <main className="content">
          <div className="container">{children}</div>
        </main>
      </div>
    </div>
  );
}