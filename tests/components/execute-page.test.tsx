// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/execute" }));

import ExecutePage from "@/app/execute/page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const view = () => render(<ChakraProvider value={defaultSystem}><ExecutePage /></ChakraProvider>);

describe("ExecutePage", () => {
  it("sends a C12 procedure request with typed params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: "nope" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("button", { name: "Procedure" }));
    await user.type(screen.getByLabelText("Procedure name"), "dbo.Get");
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    await user.type(screen.getByLabelText("Parameter 1 name"), "@id");
    fireEvent.change(screen.getByLabelText("Parameter 1 type"), { target: { value: "int" } });
    await user.type(screen.getByLabelText("Parameter 1 value"), "42");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/execute");
    expect(JSON.parse(init.body)).toEqual({
      mode: "single", engine: "simulation",
      original: { kind: "procedure", name: "dbo.Get", params: [{ name: "@id", type: "int", value: 42 }] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });

  it("rejects a non-numeric int parameter without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Procedure" }));
    await user.type(screen.getByLabelText("Procedure name"), "p");
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    await user.type(screen.getByLabelText("Parameter 1 name"), "@id");
    fireEvent.change(screen.getByLabelText("Parameter 1 type"), { target: { value: "int" } });
    await user.type(screen.getByLabelText("Parameter 1 value"), "abc");
    // UX-1: the run is blocked while the input is invalid, and the reason is shown next to the button.
    expect(screen.getByRole("button", { name: /Execute & Audit/ })).toBeDisabled();
    expect(screen.getByText(/Fix before running: Parameter @id must be a number/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Connect checks the login and lists the databases to choose from", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ databases: ["master", "TestDB"] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/execute/databases");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).engine).toBe("mssql");
    expect(await screen.findByText(/Connected\. 2 databases available/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Database" })).toBeInTheDocument();
  });

  it("Cancel aborts the in-flight execute fetch", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_res, rej) => {
        signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    }));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await user.click(cancel);
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("cancelled");
    await act(async () => {});
  });
});

describe("ExecutePage null handling and validation", () => {
  const analysis = (over: object = {}) => ({
    performanceGrade: "A", gradeRationale: "r", summary: "s",
    ioAnalysis: { totalLogicalReads: 1, totalPhysicalReads: 0, totalScanCount: 1, hotTables: [] },
    timeAnalysis: { totalMs: 5, parseTimeMs: null, executeTimeMs: null, classification: "c", recommendation: "r" },
    prosAndCons: { pros: [], cons: [] }, recommendations: [], ...over,
  });
  const exec = { recordNumber: 1, connectionEngine: "simulation", executedAt: "n", success: true, spLabel: "SP", stats: { rawOutput: "", simulated: true } };

  it("hides the strip for null improvementPercent, shows null times and warnings", async () => {
    const result = {
      mode: "compare", simulated: true, warnings: ["careful"],
      original: { execution: exec, analysis: analysis() },
      optimized: { execution: exec, analysis: analysis() },
      comparison: analysis({ improvementPercent: null }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result })));
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Compare Original vs Optimized" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.type(screen.getByPlaceholderText(/Paste your Optimized SP/), "select 2");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    expect(await screen.findByText("careful")).toBeInTheDocument();
    expect(screen.queryByText(/I\/O Regression/)).toBeNull();
    expect(screen.getAllByText("Not captured").length).toBe(2);
  });

  it("shows the verdict first, row counts, parameters and outputs for a single run (P8-04)", async () => {
    const single = {
      mode: "single", simulated: true, warnings: [],
      execution: { ...exec, outputs: { ExecutionLogID: 2 } },
      analysis: analysis({
        performanceGrade: null, gradeRationale: "Not graded — Customers has 0 rows",
        prodVerdict: { verdict: "INSUFFICIENT EVIDENCE", reason: "Customers has 0 rows", driver: "Customers" },
        ioAnalysis: { rowCounts: { Customers: 0 }, totalLogicalReads: 1, totalPhysicalReads: 0, totalScanCount: 1, hotTables: [] },
        planOperators: [{ nodeId: 8, physicalOp: "Clustered Index Scan", table: "Customers", actualRows: 1000000, logicalReads: 9185, executions: 1 }],
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: single })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    const verdict = await screen.findByLabelText("Prod-readiness verdict");
    expect(verdict).toHaveTextContent("INSUFFICIENT EVIDENCE");
    expect(verdict).toHaveTextContent("Customers has 0 rows");
    expect(screen.getByText("Not graded")).toBeInTheDocument();
    expect(screen.getByText("Row counts (tables read)")).toBeInTheDocument();
    expect(screen.getByText("OUTPUT parameters")).toBeInTheDocument();
    expect(screen.getByText(/ExecutionLogID/)).toBeInTheDocument();
    expect(screen.getByText("Costliest plan operators")).toBeInTheDocument();
    expect(screen.getByText(/Clustered Index Scan on Customers/)).toBeInTheDocument();
  });

  it("shows the repeated-runs summary when the run was repeated (P8-03)", async () => {
    const single = {
      mode: "single", simulated: true, warnings: [], execution: exec,
      analysis: analysis({
        prodVerdict: { verdict: "UNSTABLE", reason: "elapsed varies 120% across 4 runs", driver: null },
        multiRun: { runs: 4, warmupRuns: 1, elapsedMs: { min: 10, median: 25, p95: 40, max: 40 }, logicalReads: { min: 1, median: 1, p95: 1, max: 1 }, spreadPct: 120 },
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: single })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    expect(await screen.findByText("4 measured runs (warm-up of 1 dropped)")).toBeInTheDocument();
    expect(screen.getByLabelText("Prod-readiness verdict")).toHaveTextContent("UNSTABLE");
  });

  it("shows the recommendations by priority, the grade legend, and the raw-output help (P8-08)", async () => {
    const single = {
      mode: "single", simulated: true, warnings: [], execution: exec,
      analysis: analysis({
        planFindings: [
          { kind: "cost-concentration", severity: "high", operator: "Seek", table: "T", message: "Seek on T accounts for 90% of logical reads", recommendation: "Seek on T accounts for 90% of logical reads. Review it." },
          { kind: "tempdb-spill", severity: "medium", operator: "Sort", table: null, message: "Sort spilled 10 pages to tempdb", recommendation: "Sort spilled 10 pages to tempdb. Fix the estimate." },
        ],
        recommendations: ["Seek on T accounts for 90% of logical reads. Review it.", "Sort spilled 10 pages to tempdb. Fix the estimate.", "Other observation here"],
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: single })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    const panel = await screen.findByLabelText("Recommendations");
    expect(panel).toHaveTextContent("High priority");
    expect(panel).toHaveTextContent("Medium priority");
    expect(panel).toHaveTextContent("Other observations");
    expect(panel).toHaveTextContent("Standard checks");
    expect(panel).toHaveTextContent("Other observation here");
    expect(screen.getByLabelText("Grade legend")).toBeInTheDocument();
    expect(screen.getByText(/parsed from this text/)).toBeInTheDocument();
  });

  it("shows the original and optimized SQL side by side after a compare run (P8-08)", async () => {
    const result = {
      mode: "compare", simulated: true, warnings: [],
      original: { execution: exec, analysis: analysis() },
      optimized: { execution: exec, analysis: analysis({ performanceGrade: "B" }) },
      comparison: analysis({ improvementPercent: 10 }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result })));
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Compare Original vs Optimized" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.type(screen.getByPlaceholderText(/Paste your Optimized SP/), "select 2");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    const panel = await screen.findByLabelText("Original and optimized SQL");
    expect(panel).toHaveTextContent("select 1");
    expect(panel).toHaveTextContent("select 2");
    expect(panel).toHaveTextContent("Grade B");
  });

  it("offers a refactor after a run, and Use as Optimized fills the Optimized editor in compare mode (RF-2, RF-6)", async () => {
    const single = { mode: "single", simulated: true, warnings: [], execution: exec, analysis: analysis() };
    const refactored = "SELECT CustomerID FROM dbo.Customers;";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/review/models") return json({ models: [{ id: "m1", name: "Model One", compatible: true }] });
      if (url === "/api/refactor") {
        return json({ result: {
          status: "provided", refactoredSql: refactored, formatted: true, checks: [], summary: "s", changes: [],
          indexRecommendations: [], viewRecommendations: [], otherRecommendations: [], limitations: [],
        } });
      }
      return json({ result: single });
    }));
    const user = userEvent.setup();
    view();
    expect(screen.queryByRole("button", { name: "Refactor Stored Procedure" })).toBeNull();
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select * from dbo.Customers");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    await user.click(await screen.findByRole("button", { name: "Refactor Stored Procedure" }));
    await screen.findByRole("option", { name: "Model One" });
    await user.click(screen.getByRole("button", { name: "Generate refactor" }));
    await user.click(await screen.findByRole("button", { name: "Use as Optimized" }));
    expect(screen.getByPlaceholderText(/Paste your Optimized SP/)).toHaveValue(refactored);
    expect(screen.getByPlaceholderText(/Paste your Stored Procedure/)).toHaveValue("select * from dbo.Customers");
  });

  it("copies the raw output to the clipboard from the raw-output panel", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const single = {
      mode: "single", simulated: true, warnings: [],
      execution: { ...exec, stats: { ...exec.stats, rawOutput: "Table 'SalesOrders'. Scan count 5, logical reads 6" } },
      analysis: analysis(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: single })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    await user.click(await screen.findByRole("button", { name: "Show" }));
    await user.click(screen.getByRole("button", { name: "Copy raw output" }));
    expect(writeText).toHaveBeenCalledWith("Table 'SalesOrders'. Scan count 5, logical reads 6");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("blocks an empty port without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.type(screen.getByLabelText("Database"), "db");
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.clear(screen.getByLabelText("Port"));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Port must be");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ExecutePage SQL Server connection (PG-1, P9-01, DB-1)", () => {
  it("offers SQL Server first and selected, and no PostgreSQL", () => {
    vi.stubGlobal("fetch", vi.fn());
    view();
    const engine = screen.getByLabelText("Server type") as HTMLSelectElement;
    expect(engine.value).toBe("mssql");
    expect(Array.from(engine.options).map((o) => o.textContent)).toEqual(["SQL Server", "Simulation (no database needed)"]);
    expect(screen.getByRole("heading", { name: "Connect to Server" })).toBeInTheDocument();
  });

  it("sends a Windows login with its domain, lists the databases and uses the one picked", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/execute/databases" ? json({ databases: ["master", "TestDB"] }) : json({ ok: true, serverVersion: "16.0" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    expect(screen.queryByLabelText("Domain")).toBeNull();
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "windows" } });
    // Security condition: a Windows login with an unchecked certificate is called out on the form.
    expect(screen.getByRole("note")).toHaveTextContent(/certificate is not checked/);
    fireEvent.click(screen.getByLabelText("Trust server certificate"));
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByLabelText("Trust server certificate"));
    await user.type(screen.getByLabelText("Domain"), "CORP");
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "jsmith");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const list = (await screen.findByRole("combobox", { name: "Database" })) as HTMLSelectElement;
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/execute/databases") as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      engine: "mssql",
      connection: { host: "localhost", username: "jsmith", password: "pw", authType: "windows", domain: "CORP", database: "" },
    });
    fireEvent.change(list, { target: { value: "TestDB" } });
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/execute")).toBe(true));
    const run = fetchMock.mock.calls.find(([url]) => url === "/api/execute") as unknown as [string, RequestInit];
    expect(JSON.parse(run[1].body as string).connection).toMatchObject({ database: "TestDB", authType: "windows", domain: "CORP" });
  });

  it("drops the loaded list when the login changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ databases: ["TestDB"] })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("combobox", { name: "Database" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "x");
    expect(screen.queryByRole("combobox", { name: "Database" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Database" })).toBeInTheDocument();
  });
});
