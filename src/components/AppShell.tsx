"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/", label: "Overview", icon: "◫" },
  { href: "/review", label: "Review SP", icon: "▣" },
  { href: "/execute", label: "Execute", icon: "▶" },
  { href: "/compare", label: "Compare", icon: "⇄" },
  { href: "/audit", label: "Audit", icon: "☰" },
  { href: "/settings", label: "Settings", icon: "⚙" },
  { href: "/manage-models", label: "Models", icon: "◎" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (isLogin) return;
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { authenticated?: boolean; user?: { username?: string } }) => {
        if (!cancelled) {
          setUsername(payload.authenticated ? (payload.user?.username ?? null) : null);
        }
      })
      .catch(() => {
        if (!cancelled) setUsername(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isLogin, pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUsername(null);
      setLoggingOut(false);
      router.replace("/login");
    }
  }

  if (isLogin) return <>{children}</>;

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
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));

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
            {username && (
              <div className="panel panel-card compact-panel">
                <div className="page-kicker">Signed in</div>
                <div data-testid="current-user">{username}</div>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void handleLogout()}
                  disabled={loggingOut}
                >
                  {loggingOut ? "Signing out..." : "Logout"}
                </button>
              </div>
            )}
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