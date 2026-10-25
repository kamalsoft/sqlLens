// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/review" }));

import ReviewPage from "@/app/review/page";
import { groupRecommendations } from "@/components/review/RecommendationGroups";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const v1 = {
  summary: "v1 summary",
  issues: [
    { severity: "low", title: "Low one", explanation: "e", recommendation: "r-low" },
    { severity: "critical", title: "Crit one", explanation: "e", recommendation: "r-crit" },
  ],
  rewrittenProcedure: "SELECT 1",
  confidence: 0.5,
};
const v2 = {
  summary: "v2 summary",
  overallRisk: "high",
  confidence: 0.8,
  findingsTable: [
    { category: "security", finding: "F-sec-med", evidence: "ev", severity: "medium", recommendation: "r1" },
    { category: "performance", finding: "F-perf-crit", evidence: "ev", severity: "critical", recommendation: "r2" },
    { category: "correctness", finding: "F-cor-crit", evidence: "ev", severity: "critical", recommendation: "r3" },
  ],
  performanceTable: [{ area: "joins", observation: "obs", evidence: "ev", impact: "high", recommendation: "r" }],
  securityTable: [],
  testingTable: [{ test: "T1", purpose: "p", expectedResult: "x" }],
  rewrittenProcedure: "SELECT 2",
  limitations: ["Limit A"],
};

function setup(reviewResponse: () => Response | Promise<Response>, extra?: { status?: boolean }) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url === "/api/review/models") return json(200, { models: [{ id: "m1", name: "Model One", compatible: true }] });
    if (url === "/api/models/status")
      return extra?.status === false
        ? json(404, { error: "nope" })
        : json(200, { models: [{ id: "m1", name: "Model One", compatible: true, loaded: true, loading: false, lastError: null }] });
    if (url === "/api/audit") return json(200, { audits: [{ id: "abcdef123456", type: "EXECUTE", createdAt: "2026-01-01T00:00:00Z" }, { id: "zzz", type: "REVIEW", createdAt: "2026-01-01T00:00:00Z" }] });
    return reviewResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function run(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByPlaceholderText(/CREATE PROCEDURE/), "select 1");
  await user.click(screen.getByRole("button", { name: "Analyze SP" }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("groupRecommendations", () => {
  it("orders by severity then category with uncategorized last", () => {
    const g = groupRecommendations([
      { severity: "low", category: "uncategorized", title: "a", recommendation: "" },
      { severity: "critical", category: "security", title: "b", recommendation: "" },
      { severity: "critical", category: "performance", title: "c", recommendation: "" },
      { severity: "critical", category: "uncategorized", title: "d", recommendation: "" },
      { severity: "high", category: "correctness", title: "e", recommendation: "" },
    ]);
    expect(g.map((x) => x.severity)).toEqual(["critical", "high", "low"]);
    expect(g[0].categories.map((c) => c.category)).toEqual(["performance", "security", "uncategorized"]);
  });
});

describe("ReviewPage", () => {
  it("renders v2 by default, sends schemaVersion, shows status and grouping", async () => {
    const fetchMock = setup(() => json(200, { id: "i", model: "m1", schemaVersion: "v2", promptPath: "p", result: v2 }));
    const user = userEvent.setup();
    render(<ReviewPage />);
    expect(await screen.findByTestId("model-status")).toHaveTextContent("loaded");
    await run(user);

    expect(await screen.findByLabelText("Review result v2")).toBeInTheDocument();
    expect(screen.getByText("Limit A")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Testing" })).toBeInTheDocument();
    const groups = screen.getByTestId("recommendation-groups");
    expect(within(groups).getAllByTestId("severity-heading").map((h) => h.textContent)).toEqual(["CRITICAL", "MEDIUM"]);
    expect(within(groups).getAllByTestId("category-heading").map((h) => h.textContent)).toEqual(["correctness", "performance", "security"]);

    const call = fetchMock.mock.calls.find(([u]) => u === "/api/review")!;
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({ modelId: "m1", sql: "select 1", schemaVersion: "v2" });
  });

  it("sends v1 when selected and renders v1 result", async () => {
    const fetchMock = setup(() => json(200, { id: "i", model: "m1", schemaVersion: "v1", promptPath: "p", result: v1 }));
    const user = userEvent.setup();
    render(<ReviewPage />);
    const select = (await screen.findByLabelText("Result schema")) as HTMLSelectElement;
    expect(select.value).toBe("v2");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(select, { target: { value: "v1" } });
    await run(user);

    expect(await screen.findByLabelText("Review result v1")).toBeInTheDocument();
    const heads = screen.getAllByTestId("severity-heading").map((h) => h.textContent);
    expect(heads).toEqual(["CRITICAL", "LOW"]);
    expect(screen.getAllByTestId("category-heading").every((h) => h.textContent === "uncategorized")).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u === "/api/review")![1].body);
    expect(body.schemaVersion).toBe("v1");
    expect(body).not.toHaveProperty("executionAuditId");
  });

  it("sends executionAuditId only when selected", async () => {
    const fetchMock = setup(() => json(200, { schemaVersion: "v2", result: v2 }));
    const user = userEvent.setup();
    render(<ReviewPage />);
    const pick = (await screen.findByLabelText("Include telemetry from execution")) as HTMLSelectElement;
    expect(within(pick).getAllByRole("option")).toHaveLength(2); // None + the EXECUTE audit only
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(pick, { target: { value: "abcdef123456" } });
    await run(user);
    await screen.findByLabelText("Review result v2");
    const body = JSON.parse(fetchMock.mock.calls.find(([u]) => u === "/api/review")![1].body);
    expect(body.executionAuditId).toBe("abcdef123456");
  });

  it("works when /api/models/status is unavailable", async () => {
    setup(() => json(200, { schemaVersion: "v2", result: v2 }), { status: false });
    render(<ReviewPage />);
    await screen.findByLabelText("Result schema");
    expect(screen.queryByTestId("model-status")).toBeNull();
  });

  it.each([
    [429, { error: "Another review is still running." }, /busy/i],
    [504, { error: "x" }, /timed out.*smaller input or a smaller model/i],
    [502, { error: "Unable to parse model response", details: { responsePreview: "garbage{" } }, /could not be parsed/i],
  ])("shows a clear message for %i", async (status, payload, pattern) => {
    setup(() => json(status as number, payload));
    const user = userEvent.setup();
    render(<ReviewPage />);
    await run(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(pattern as RegExp);
    if (status === 502) expect(screen.getByLabelText("Response preview")).toHaveTextContent("garbage{");
  });
});
