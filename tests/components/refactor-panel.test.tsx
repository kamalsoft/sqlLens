// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";
import type { AuditAnalysis } from "@/lib/audit-analyzer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/execute" }));

import { RefactorPanel, type RefactorSource } from "@/components/execute/refactor-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const analysis = {
  prodVerdict: { verdict: "OPTIMIZE", reason: "Customers scan is 60% of reads", driver: "Customers" },
  ioAnalysis: { totalLogicalReads: 14139, hotTables: [{ table: "Customers", logicalReads: 9315, scanCount: 11, concern: "" }] },
  timeAnalysis: { totalMs: 684 },
  planFindings: [],
} as unknown as AuditAnalysis;

const refactor = {
  id: "rec-1",
  result: {
    status: "provided", refactoredSql: "SELECT CustomerID FROM dbo.Customers WHERE RegionID = @RegionID;", formatted: true,
    checks: [{ id: "params", label: "Same parameters", passed: true }],
    summary: "Replaced the scan with a seek.", changes: ["Removed SELECT *"],
    indexRecommendations: [{ table: "dbo.Customers", keyColumns: ["RegionID"], includeColumns: [], reason: "Seek on region", evidence: "", createStatement: "CREATE INDEX IX_Customers_RegionID ON dbo.Customers (RegionID);" }],
    viewRecommendations: [], otherRecommendations: ["Update statistics on dbo.Customers"], limitations: [],
  },
};

function setup(source: RefactorSource, engine: "simulation" | "mssql" = "simulation", routes: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === "/api/review/models") return json({ models: [{ id: "m1", name: "Model One", compatible: true }] });
    if (routes[url]) return routes[url]();
    if (url === "/api/refactor") return json(refactor);
    return json({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  const onUse = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <RefactorPanel source={source} engine={engine} connection={{ host: "localhost", database: "TestDB" }} analysis={analysis} onUseAsOptimized={onUse} />
    </ChakraProvider>,
  );
  const callsTo = (url: string) => fetchMock.mock.calls.filter((c) => c[0] === url).map((c) => JSON.parse((c[1] as RequestInit).body as string));
  return { onUse, callsTo, user: userEvent.setup() };
}

async function generate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Refactor Stored Procedure" }));
  await screen.findByRole("option", { name: "Model One" });
  await user.click(screen.getByRole("button", { name: "Generate refactor" }));
}

describe("RefactorPanel (RF-2/3/4/6)", () => {
  it("refactors the batch as run, sends the run's evidence, and shows each section with copy buttons", async () => {
    const { callsTo, onUse, user } = setup({ kind: "batch", sql: "SELECT * FROM dbo.Customers" });
    expect(screen.queryByRole("button", { name: "Generate refactor" })).not.toBeInTheDocument();
    await generate(user);

    expect(await screen.findByLabelText("Refactored SQL")).toHaveTextContent("WHERE RegionID = @RegionID");
    const [body] = callsTo("/api/refactor");
    expect(body.modelId).toBe("m1");
    expect(body.sql).toBe("SELECT * FROM dbo.Customers");
    expect(body.instructions).toContain("Verdict: OPTIMIZE. Customers scan is 60% of reads (driver: Customers)");
    expect(body.instructions).toContain("Table Customers: 9315 logical reads, scan count 11.");
    expect(callsTo("/api/execute/definition")).toEqual([]);

    expect(screen.getByText("Index recommendations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy index script for dbo.Customers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy refactored SQL" })).toBeInTheDocument();
    expect(screen.getByText("Update statistics on dbo.Customers")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use as Optimized" }));
    expect(onUse).toHaveBeenCalledWith(refactor.result.refactoredSql);
  });

  it("reads a procedure's definition from SQL Server, then refactors that text", async () => {
    const definition = "CREATE PROCEDURE dbo.usp_Get AS SELECT * FROM dbo.Customers";
    const { callsTo, user } = setup({ kind: "procedure", name: "dbo.usp_Get" }, "mssql", {
      "/api/execute/definition": () => json({ definition }),
    });
    await generate(user);
    await screen.findByLabelText("Refactored SQL");
    expect(callsTo("/api/execute/definition")).toEqual([{ engine: "mssql", name: "dbo.usp_Get", connection: { host: "localhost", database: "TestDB" } }]);
    expect(callsTo("/api/refactor")[0].sql).toBe(definition);
    // A procedure's refactor is a CREATE script: it is not offered as something to time.
    expect(screen.queryByRole("button", { name: "Use as Optimized" })).not.toBeInTheDocument();
    expect(screen.getByText(/create the refactored procedure under a new name/)).toBeInTheDocument();
  });

  it("explains that a procedure needs SQL Server, and calls nothing, when run in simulation", async () => {
    const { callsTo, user } = setup({ kind: "procedure", name: "dbo.usp_Get" }, "simulation");
    await generate(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/needs a live SQL Server connection/);
    expect(callsTo("/api/execute/definition")).toEqual([]);
    expect(callsTo("/api/refactor")).toEqual([]);
  });

  it("shows the definition error and does not call the model", async () => {
    const { callsTo, user } = setup({ kind: "procedure", name: "dbo.nope" }, "mssql", {
      "/api/execute/definition": () => json({ error: "No readable definition: this login lacks VIEW DEFINITION" }, 404),
    });
    await generate(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/VIEW DEFINITION/);
    expect(callsTo("/api/refactor")).toEqual([]);
  });

  it("shows the model's raw output when it could not be read", async () => {
    const { user } = setup({ kind: "batch", sql: "SELECT 1" }, "simulation", {
      "/api/refactor": () => json({ error: "Unable to parse model response", details: { responseText: "not json" } }, 502),
    });
    await generate(user);
    expect(await screen.findByLabelText("Response preview")).toHaveTextContent("not json");
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to parse model response");
  });
});
