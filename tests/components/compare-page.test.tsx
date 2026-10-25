// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/compare" }));

import ComparePage from "@/app/compare/page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const view = () => render(<ChakraProvider value={defaultSystem}><ComparePage /></ChakraProvider>);

function setup(compare: () => Response) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) =>
    url === "/api/review/models"
      ? json({ models: [{ id: "m1", name: "Model One", compatible: true }, { id: "bad", name: "Bad", compatible: false }] })
      : compare(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fill(original: string, optimized: string) {
  const [a, b] = screen.getAllByRole("textbox");
  fireEvent.change(a, { target: { value: original } });
  fireEvent.change(b, { target: { value: optimized } });
}

describe("ComparePage", () => {
  it("sends the selected model and renders the verdict, differences and risks", async () => {
    const fetchMock = setup(() =>
      json({
        id: "audit1",
        metrics: null,
        result: { winner: "optimized", summary: "Fewer passes over SalesOrders.", differences: ["Removed #StagedSales"], risks: ["Removed BEGIN TRANSACTION"], confidence: 0.4 },
      }),
    );
    const user = userEvent.setup();
    view();
    expect(await screen.findByRole("option", { name: "Model One" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Bad" })).toBeNull();
    await fill("SELECT 1", "SELECT 2");
    await user.click(screen.getByRole("button", { name: /Compare SPs/ }));

    expect(await screen.findByTestId("compare-winner")).toHaveTextContent("Improved SP is better");
    expect(screen.getByText("Removed #StagedSales")).toBeInTheDocument();
    expect(screen.getByText("Removed BEGIN TRANSACTION")).toBeInTheDocument();
    expect(screen.getByText(/No execution metrics were captured/)).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u === "/api/compare")![1].body);
    expect(body).toEqual({ modelId: "m1", original: "SELECT 1", optimized: "SELECT 2" });
  });

  it("blocks non-SQL input before calling the API", async () => {
    const fetchMock = setup(() => json({}));
    const user = userEvent.setup();
    view();
    await screen.findByRole("option", { name: "Model One" });
    await fill("hello there", "SELECT 2");
    await user.click(screen.getByRole("button", { name: /Compare SPs/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not look like SQL/);
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/compare")).toBe(false);
  });

  it("shows the model output preview when the answer cannot be parsed", async () => {
    setup(() => json({ error: "Unable to parse model response", details: { responsePreview: "{ winner: maybe", message: "winner must be one of; response ended with: x" } }, 502));
    const user = userEvent.setup();
    view();
    await screen.findByRole("option", { name: "Model One" });
    await fill("SELECT 1", "SELECT 2");
    await user.click(screen.getByRole("button", { name: /Compare SPs/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to parse model response");
    expect(screen.getByLabelText("Response preview")).toHaveTextContent("{ winner: maybe");
  });
});
