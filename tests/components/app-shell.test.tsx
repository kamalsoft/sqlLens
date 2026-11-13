// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "./user";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const router = { replace, push: vi.fn() };
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { AppShell } from "@/components/AppShell";
import { LeaveGuardProvider, useLeaveGuard } from "@/components/leave-guard";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  pathname = "/";
  replace.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("shows the current user and logs out to /login", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === "/api/auth/me" ? json(200, { authenticated: true, user: { username: "admin" } }) : json(200, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AppShell><p>content</p></AppShell>);

    expect(await screen.findByTestId("current-user")).toHaveTextContent("admin");
    // LG-1: the logo mark sits next to the name and is hidden from screen readers.
    const mark = document.querySelector(".brand svg.logo-mark");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { name: "SQLLens" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings/ })).toBeInTheDocument();

    // HP-2: the top bar shows the user and its own Logout, always visible.
    const signedIn = screen.getByLabelText("Signed in as");
    expect(signedIn).toHaveTextContent("admin");
    const bar = signedIn.closest("header") as HTMLElement;
    expect(bar).toHaveClass("topbar");
    // HP-3: the disclaimer and Help link on every page; Help is in the menu.
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/results can be wrong or incomplete\. Check with your DBA before changing a production database\./);
    expect(within(footer).getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("link", { name: /\?Help/ })).toHaveAttribute("href", "/help");

    await user.click(within(bar).getByRole("button", { name: "Logout" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    const logout = fetchMock.mock.calls.find(([url]) => url === "/api/auth/logout")!;
    expect(logout[1].method).toBe("POST");
  });

  it("renders no shell and makes no auth request on /login", () => {
    pathname = "/login";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AppShell><p>login form</p></AppShell>);

    expect(screen.getByText("login form")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    // The disclaimer shows on sign-in too, without a Help link (Help needs a session).
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/Check with your DBA/);
    expect(screen.queryByRole("link", { name: "Help" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides Compare and Refactor until Settings switches them on (UX-A)", async () => {
    let config = { showCompare: false, showRefactor: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/appconfig" ? json(200, config) : json(200, { authenticated: true, user: { username: "admin" } })));
    render(<AppShell><p>content</p></AppShell>);
    await screen.findByTestId("current-user");
    expect(screen.queryByRole("link", { name: /Compare/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Refactor/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Execute/ })).toBeInTheDocument();

    config = { showCompare: true, showRefactor: false };
    window.dispatchEvent(new Event("sqllens:settings-saved"));
    expect(await screen.findByRole("link", { name: /Compare/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Refactor/ })).toBeNull();
  });
});

describe("AppShell leave guard (UX-B)", () => {
  function Running({ cancel }: { cancel: () => void }) {
    useLeaveGuard(true, "A refactor", cancel);
    return <p>working</p>;
  }
  const shell = (cancel: () => void) => render(
    <ChakraProvider value={defaultSystem}>
      <LeaveGuardProvider>
        <AppShell><Running cancel={cancel} /></AppShell>
      </LeaveGuardProvider>
    </ChakraProvider>,
  );

  beforeEach(() => {
    router.push.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { authenticated: true, user: { username: "admin" } })));
  });

  it("asks before leaving, and staying keeps the task", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    shell(cancel);
    await user.click(screen.getByRole("link", { name: /Audit$/ }));
    expect(await screen.findByText("A refactor is still running. Leaving cancels it, and the result is lost.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay on this screen" }));
    expect(cancel).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("cancels the task and goes when the user chooses to leave", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    shell(cancel);
    await user.click(screen.getByRole("link", { name: /Audit$/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel the task and leave" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/audit");
  });

  it("asks before logging out too", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    shell(cancel);
    await user.click((await screen.findAllByRole("button", { name: "Logout" }))[0]);
    expect(await screen.findByRole("button", { name: "Cancel the task and leave" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("guards every task that runs at once, and leaving cancels them all", async () => {
    const run = vi.fn();
    const refactor = vi.fn();
    function Both() {
      useLeaveGuard(true, "An execution", run);
      useLeaveGuard(true, "A refactor", refactor);
      return <p>working</p>;
    }
    render(<ChakraProvider value={defaultSystem}><LeaveGuardProvider><AppShell><Both /></AppShell></LeaveGuardProvider></ChakraProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: /Audit$/ }));
    expect(await screen.findByText("An execution and a refactor are still running. Leaving cancels them, and the result is lost.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel the task and leave" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(refactor).toHaveBeenCalledTimes(1);
  });

  it("drops the question when its task finishes, so it does not come back for the next task", async () => {
    function Toggle({ active }: { active: boolean }) {
      useLeaveGuard(active, "A review", () => {});
      return <p>working</p>;
    }
    const tree = (active: boolean) => (
      <ChakraProvider value={defaultSystem}><LeaveGuardProvider><AppShell><Toggle active={active} /></AppShell></LeaveGuardProvider></ChakraProvider>
    );
    const view = render(tree(true));
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: /Audit$/ }));
    expect(await screen.findByRole("button", { name: "Stay on this screen" })).toBeInTheDocument();

    view.rerender(tree(false));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stay on this screen" })).toBeNull());
    view.rerender(tree(true));
    expect(screen.queryByRole("button", { name: "Stay on this screen" })).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});
