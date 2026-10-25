// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "./user";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const router = { replace, push: vi.fn() };
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));

import { AppShell } from "@/components/AppShell";

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
    expect(screen.getByRole("link", { name: /Settings/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));
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
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
