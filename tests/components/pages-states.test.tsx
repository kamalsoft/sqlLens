// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "./user";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/review",
}));

import ReviewPage from "@/app/review/page";
import OverviewPage from "@/app/page";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const models = { models: [{ id: "m1", name: "Model One", compatible: true }] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockClear();
});

describe("Review page states", () => {
  it("shows pending, disables the button, then the API error", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      url === "/api/review/models" ? Promise.resolve(json(200, models)) : new Promise<Response>((r) => (resolve = r))
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ReviewPage />);

    await user.type(await screen.findByPlaceholderText(/CREATE PROCEDURE/), "select 1");
    await user.click(screen.getByRole("button", { name: "Analyze SP" }));

    expect(await screen.findByText("Running local analysis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyzing/ })).toBeDisabled();

    resolve(json(429, { error: "Rate limit exceeded" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limit exceeded");
    expect(screen.getByRole("button", { name: "Analyze SP" })).toBeEnabled();
  });

  it("redirects to /login?next= on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "Authentication required" })));
    render(<ReviewPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Freview"));
  });
});

describe("Overview page states", () => {
  it("shows loading then the API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: "Internal error" })));
    render(<OverviewPage />);
    expect(screen.getByText("Loading overview...")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Internal error");
  });
});
