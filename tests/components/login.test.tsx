// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "./user";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/login",
}));

import LoginPage from "@/app/login/page";
import { sanitizeNext } from "@/components/api-client";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Username"), "admin");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    replace.mockClear();
    window.history.pushState({}, "", "/login");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("posts credentials and redirects to / on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(JSON.parse(init.body)).toEqual({ username: "admin", password: "correct-horse-battery" });
  });

  it("redirects to a safe next parameter", async () => {
    window.history.pushState({}, "", "/login?next=%2Freview");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, {})));
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/review"));
  });

  it("ignores an external next parameter", async () => {
    window.history.pushState({}, "", "/login?next=%2F%2Fevil.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, {})));
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("sanitizes next values", () => {
    expect(sanitizeNext("/execute?x=1")).toBe("/execute?x=1");
    expect(sanitizeNext("//evil.example")).toBe("/");
    expect(sanitizeNext("https://evil.example")).toBe("/");
    expect(sanitizeNext("/\\evil.example")).toBe("/");
    expect(sanitizeNext("/\t/evil.example")).toBe("/");
    expect(sanitizeNext("/\n/evil.example")).toBe("/");
    expect(sanitizeNext("/review?next=%2F%2Fx")).toBe("/review?next=%2F%2Fx");
    expect(sanitizeNext("evil")).toBe("/");
    expect(sanitizeNext(null)).toBe("/");
  });

  it("shows the API error on 401 and does not redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "Invalid credentials" })));
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled(); // password cleared
  });

  it("shows the 429 message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(429, { error: "Too many attempts" })));
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("disables submit and shows a loading label while pending", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r))));
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user);

    const button = await screen.findByRole("button", { name: "Signing in..." });
    expect(button).toBeDisabled();
    resolve(json(401, { error: "Invalid credentials" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Password")).toBeEnabled();
  });
});
