"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";
import { useRunningTask, type RunningTasks } from "./leave-guard";

type Feature = "showCompare" | "showRefactor";

/** Fired by the Settings screen after a save, so the menu shows or hides screens at once. */
export const SETTINGS_SAVED_EVENT = "sqllens:settings-saved";

const navItems: { href: string; label: string; icon: string; feature?: Feature }[] = [
  { href: "/", label: "Overview", icon: "◫" },
  { href: "/review", label: "Review SP", icon: "▣" },
  { href: "/execute", label: "Execute & Audit SP", icon: "▶" },
  { href: "/compare", label: "Compare", icon: "⇄", feature: "showCompare" },
  { href: "/refactor", label: "Refactor", icon: "✎", feature: "showRefactor" },
  { href: "/audit", label: "Audit", icon: "☰" },
  { href: "/settings", label: "Settings", icon: "⚙" },
  { href: "/manage-models", label: "Manage Models", icon: "◎" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  // UX-A: screens switched on in Settings. Unknown until loaded, so optional screens start hidden.
  const [features, setFeatures] = useState<Record<Feature, boolean> | null>(null);
  const task = useRunningTask();
  // UX-B: where the user tried to go, and the task that was running then. The question shows only while
  // that same task runs, so it cannot reappear for a later task.
  const [pending, setPending] = useState<{ href: string; task: RunningTasks } | null>(null);
  const asking = pending !== null && pending.task === task;
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (isLogin) return;
    let cancelled = false;
    const load = () =>
      fetch("/api/appconfig", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((config: Partial<Record<Feature, unknown>> | null) => {
          if (!cancelled && config) setFeatures({ showCompare: config.showCompare === true, showRefactor: config.showRefactor === true });
        })
        .catch(() => {});
    void load();
    window.addEventListener(SETTINGS_SAVED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_SAVED_EVENT, load);
    };
  }, [isLogin]);

  /** Leaving while a task runs asks first; the answer either cancels the task and goes, or stays. */
  function guardNavigation(event: React.MouseEvent, href: string) {
    if (!task || href === pathname) return;
    event.preventDefault();
    setPending({ href, task });
  }

  function leaveAnyway() {
    if (!pending) return;
    setPending(null);
    pending.task.cancel();
    if (pending.href === "logout") void handleLogout();
    else router.push(pending.href);
  }

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
            {navItems.filter((item) => !item.feature || features?.[item.feature]).map((item) => {
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${isActive ? "active" : ""}`}
                  onClick={(event) => guardNavigation(event, item.href)}
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
                  onClick={() => (task ? setPending({ href: "logout", task }) : void handleLogout())}
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
        {asking && (
          <ConfirmDialog
            open
            title={pending.task.many ? "Tasks are still running" : "A task is still running"}
            message={`${pending.task.label} ${pending.task.many ? "are" : "is"} still running. Leaving cancels ${pending.task.many ? "them" : "it"}, and the result is lost.`}
            confirmLabel="Cancel the task and leave"
            cancelLabel="Stay on this screen"
            onConfirm={leaveAnyway}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
    </div>
  );
}