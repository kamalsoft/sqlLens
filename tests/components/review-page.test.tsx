// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/review" }));

import ReviewPage from "@/app/review/page";
import { groupRecommendations } from "@/components/review/RecommendationGroups";
import { ReviewResultView } from "@/components/review/ReviewResultView";

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

const run57 = {
  id: "run57", type: "EXECUTE", status: "ok", createdAt: "2026-11-12T19:37:00Z", recordNumber: 57, simulated: false,
  procedure: "dbo.GetOrders", database: "SalesDB", grade: "B", elapsedMs: 120, logicalReads: 4210,
};
const run57Record = {
  id: "run57", type: "EXECUTE",
  response: { execution: { stats: {
    simulated: false, parseAndCompileTime: 2, parseAndCompileCpu: 1, executionTime: 118, executionCpu: 90, totalElapsedMs: 120,
    io: [{ table: "Orders", scanCount: 1, logicalReads: 4210, physicalReads: 3 }], plan: "<ShowPlanXML/>", rawOutput: "SECRET RAW",
  } } },
};

function setup(reviewResponse: () => Response | Promise<Response>, runs: unknown[] = [run57]) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url === "/api/audit") return json(200, { audits: [...runs, { id: "zzz", type: "REVIEW", status: "ok", createdAt: "2026-01-01T00:00:00Z" }] });
    if (url === "/api/audit/run57") return json(200, run57Record);
    return reviewResponse();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const view = () => render(<ChakraProvider value={defaultSystem}><ReviewPage /></ChakraProvider>);

async function run(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Stored procedure"), "select 1");
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

describe("ReviewPage (RV-4, RV-5)", () => {
  it("lays out numbered steps, sends no model or schema, and shows the result in tabs", async () => {
    const fetchMock = setup(() => json(200, { id: "i", model: "acme/Qwen-1.5B-Instruct", schemaVersion: "v2", result: v2 }));
    const user = userEvent.setup();
    view();
    for (const name of ["Stored procedure", "Evidence (optional)", "Analyze"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Change in Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "Analyze SP" })).toBeDisabled();
    await run(user);

    const call = fetchMock.mock.calls.find(([u]) => u === "/api/review")!;
    expect(JSON.parse(call[1].body)).toEqual({ sql: "select 1" });
    expect(await screen.findByText("v2 summary")).toBeInTheDocument();
    expect(screen.getByText("Limit A")).toBeInTheDocument();
    expect(screen.getByText(/Model: acme\/Qwen-1.5B-Instruct/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Findings" }));
    const groups = await screen.findByTestId("recommendation-groups");
    expect(within(groups).getAllByTestId("severity-heading").map((h) => h.textContent)).toEqual(["CRITICAL", "MEDIUM"]);
    expect(screen.getByRole("table", { name: "Testing" })).toBeInTheDocument();
    expect(screen.queryByText("Recommended restructure")).toBeNull();
    expect(screen.getByRole("link", { name: "Execute & Audit SP" })).toHaveAttribute("href", "/execute");
  });

  it("lists runs by procedure, database, grade, time and reads, previews the telemetry, and sends the chosen run", async () => {
    const fetchMock = setup(() => json(200, { schemaVersion: "v2", result: v2 }));
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Show your runs" }));
    const option = await screen.findByRole("option", { name: /#57 dbo\.GetOrders · SalesDB · grade B · 120 ms · 4,210 reads/ });
    expect(screen.queryByRole("option", { name: /zzz/ })).toBeNull();
    await user.click(option);
    const preview = await screen.findByRole("region", { name: "What the model will see" });
    expect(within(preview).getByText("120 ms")).toBeInTheDocument();
    expect(within(preview).getByText(/included \(14 characters\)/)).toBeInTheDocument();
    expect(within(within(preview).getByRole("table", { name: "Reads per table" })).getByText("Orders")).toBeInTheDocument();
    expect(preview.textContent).not.toContain("SECRET RAW");
    await run(user);
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/review")!;
    expect(JSON.parse(call[1].body)).toEqual({ sql: "select 1", executionAuditId: "run57" });
  });

  it("lists only successful runs; clearing the choice removes the preview and the evidence", async () => {
    const failed = { ...run57, id: "bad", status: "error", recordNumber: 58 };
    const fetchMock = setup(() => json(200, { schemaVersion: "v2", result: v2 }), [run57, failed]);
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: "Show your runs" }));
    expect(await screen.findAllByRole("option")).toHaveLength(1);
    await user.click(screen.getByRole("option", { name: /#57/ }));
    const input = screen.getByRole("combobox", { name: "Run to use as evidence" });
    expect((input as HTMLInputElement).value).toContain("#57 dbo.GetOrders");
    expect(await screen.findByRole("region", { name: "What the model will see" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use no run" }));
    expect(screen.queryByRole("region", { name: "What the model will see" })).toBeNull();
    expect(input).toHaveValue("");
    await run(user);
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/review")!;
    expect(JSON.parse(call[1].body)).toEqual({ sql: "select 1" });
  });

  it("shows an error when the runs cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: "Internal error" })));
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent("Internal error");
  });

  it("says how to get runs when there are none", async () => {
    setup(() => json(200, {}), []);
    view();
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
  });

  it("shows low-confidence and short-format notes", async () => {
    setup(() => json(200, { schemaVersion: "v1", lowConfidence: true, schemaFallback: true, result: v1 }));
    const user = userEvent.setup();
    view();
    await run(user);
    expect(await screen.findByTestId("low-confidence")).toBeInTheDocument();
    expect(screen.getByTestId("schema-fallback")).toBeInTheDocument();
    expect(screen.getByText("v1 summary")).toBeInTheDocument();
  });

  it("renders verified index recommendations with their DDL in Index ideas", async () => {
    const withIndexes = {
      ...v1,
      indexRecommendations: [{
        table: "dbo.Orders", keyColumns: ["CustomerId"], includeColumns: ["Total"],
        reason: "Supports the CustomerId filter", evidence: "WHERE o.CustomerId = @CustomerId",
        createStatement: "CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] ([CustomerId]) INCLUDE ([Total]);",
      }],
    };
    setup(() => json(200, { schemaVersion: "v1", result: withIndexes }));
    const user = userEvent.setup();
    view();
    await run(user);
    await user.click(await screen.findByRole("tab", { name: "Index ideas" }));
    expect(await screen.findByText("Supports the CustomerId filter")).toBeInTheDocument();
    expect(screen.getByText(/CREATE NONCLUSTERED INDEX \[IX_Orders_CustomerId\]/)).toBeInTheDocument();
  });

  it("says why Analyze is not ready for non-SQL input and never calls the API", async () => {
    const fetchMock = setup(() => json(200, { schemaVersion: "v2", result: v2 }));
    const user = userEvent.setup();
    view();
    await user.type(await screen.findByLabelText("Stored procedure"), "please check my essay");
    expect(screen.getByRole("button", { name: "Analyze SP" })).toBeDisabled();
    expect(screen.getByText(/does not look like SQL/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/review")).toBe(false);
  });

  it("shows unparsed model output with the failure reason", async () => {
    setup(() =>
      json(502, {
        error: "The model got stuck repeating itself and used all 3072 new tokens before finishing the JSON.",
        details: {
          responsePreview: "{ partial",
          responseText: '```json\n{"summary":"partial","extra":1}\n```',
          message: "summary: must be a string; response ended with: x",
        },
      }),
    );
    const user = userEvent.setup();
    view();
    await run(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/stuck repeating itself/);
    const preview = await screen.findByLabelText("Response preview");
    expect(preview.textContent).toBe('{\n  "summary": "partial",\n  "extra": 1\n}');
    expect(screen.getByTestId("raw-output-note")).toBeInTheDocument();
    expect(screen.getByText("Validation: summary: must be a string")).toBeInTheDocument();
  });
});

describe("ReviewResultView: older records with a rewrite (RV-2)", () => {
  it.each([
    ["provided", { rewriteStatus: "provided", rewriteNotes: ["Removed NOLOCK"], rewrittenProcedure: "CREATE PROCEDURE dbo.p AS SELECT 1" }, /Removed NOLOCK/],
    ["truncated", { rewriteStatus: "truncated", rewriteNotes: [], rewrittenProcedure: "" }, /cut off at the new-token limit/],
  ])("still shows the Recommended restructure section (%s)", (_status, fields, pattern) => {
    render(<ReviewResultView schemaVersion="v1" result={{ ...v1, indexRecommendations: [], ...fields } as never} />);
    expect(screen.getByText("Recommended restructure")).toBeInTheDocument();
    expect(screen.getByText(pattern as RegExp)).toBeInTheDocument();
  });
});
