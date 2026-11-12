// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act, waitFor, within } from "@testing-library/react";
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
    await user.click(screen.getByRole("radio", { name: "Stored procedure" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "Stored procedure" }));
    await user.type(screen.getByLabelText("Procedure name"), "p");
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    await user.type(screen.getByLabelText("Parameter 1 name"), "@id");
    fireEvent.change(screen.getByLabelText("Parameter 1 type"), { target: { value: "int" } });
    await user.type(screen.getByLabelText("Parameter 1 value"), "abc");
    // The error is linked to the field, so a screen reader reads it there.
    expect(await screen.findByLabelText("Parameter 1 value")).toHaveAccessibleDescription(/Parameter 1:/);
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
    // The connection folds; the database is chosen under What to run, which gets the focus.
    expect(await screen.findByText(/localhost · SQL login sa · 2 databases/)).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Database" });
    expect(within(screen.getByRole("region", { name: "What to run" })).getByRole("combobox", { name: "Database" })).toBe(picker);
    await waitFor(() => expect(picker).toHaveFocus());
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("checkbox", { name: "Compare with an optimized version" }));
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    const verdict = await screen.findByLabelText("Prod-readiness verdict");
    expect(verdict).toHaveTextContent("INSUFFICIENT EVIDENCE");
    expect(verdict).toHaveTextContent("Customers has 0 rows");
    // The grade appears in the one-line result bar and in the Summary tab.
    expect(screen.getAllByText("Not graded").length).toBeGreaterThan(0);
    // EX-5: row counts, parameters, outputs and plan operators are in the Details tab.
    await user.click(screen.getByRole("tab", { name: "Details" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    // The full list is in the Recommendations tab; Summary shows the top three.
    await user.click(await screen.findByRole("tab", { name: "Recommendations" }));
    const panel = await screen.findByRole("tabpanel", { name: "Recommendations" });
    expect(panel).toHaveTextContent("High priority");
    expect(panel).toHaveTextContent("Medium priority");
    expect(panel).toHaveTextContent("Other observations");
    expect(panel).toHaveTextContent("Standard checks");
    expect(panel).toHaveTextContent("Other observation here");
    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByLabelText("Grade legend")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Raw output" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("checkbox", { name: "Compare with an optimized version" }));
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    expect(screen.queryByRole("button", { name: "Generate refactor" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select * from dbo.Customers");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    await user.click(await screen.findByRole("tab", { name: "Refactor" }));
    await user.click(await screen.findByRole("button", { name: "Generate refactor" }));
    await user.click(await screen.findByRole("button", { name: "Use as Optimized" }));
    expect(screen.getByPlaceholderText(/Paste your Optimized SP/)).toHaveValue(refactored);
    expect(screen.getByPlaceholderText(/Paste your Stored Procedure/)).toHaveValue("select * from dbo.Customers");
  });

  it("reopens a saved run from Audit read-only, with its result and its saved refactor", async () => {
    const single = { mode: "single", simulated: true, warnings: [], execution: { ...exec, recordNumber: 57 }, analysis: analysis() };
    const records: Record<string, unknown> = {
      "/api/audit/run57": {
        id: "run57", type: "EXECUTE", recordNumber: 57, createdAt: "2026-11-12T10:00:00Z", modelId: null, engine: "simulation",
        request: { mode: "single", engine: "simulation", original: { kind: "batch", sql: "select 1" } },
        response: single, related: { source: null, refactors: [{ id: "rf1", recordNumber: 58 }] },
      },
      "/api/audit/rf1": {
        id: "rf1", type: "REFACTOR", modelId: "Qwen2.5-1.5B-Instruct",
        response: { status: "provided", refactoredSql: "SELECT 1;", formatted: true, checks: [], summary: "Saved summary", changes: [],
          indexRecommendations: [], viewRecommendations: [], otherRecommendations: [], limitations: [] },
      },
    };
    const fetchMock = vi.fn(async (url: string) => records[url] ? json(records[url]) : json({}));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/execute?record=run57");
    const user = userEvent.setup();
    view();
    expect(await screen.findByText("Saved run #57")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the audit record" })).toHaveAttribute("href", "/audit/run57");
    expect(screen.queryByRole("button", { name: /Execute & Audit/ })).toBeNull();
    await user.click(await screen.findByRole("tab", { name: "Refactor" }));
    expect(await screen.findByText("Saved summary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate refactor" })).toBeNull();
    expect(screen.getByRole("link", { name: "#58" })).toHaveAttribute("href", "/audit/rf1");
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/refactor" || u === "/api/execute")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Start a new run" }));
    expect(window.location.search).toBe("");
    expect(screen.queryByText("Saved run #57")).toBeNull();
    expect(screen.getByRole("heading", { name: "What to run" })).toBeInTheDocument();
  });

  it("does not render a saved run whose stored result is malformed or not a run", async () => {
    const records: Record<string, unknown> = {
      "/api/audit/bad": { id: "bad", type: "EXECUTE", recordNumber: 9, createdAt: "n", request: {}, response: { mode: "single" } },
      "/api/audit/rv": { id: "rv", type: "REVIEW", recordNumber: 10, createdAt: "n", request: {}, response: {} },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => records[url] ? json(records[url]) : json({})));
    window.history.replaceState(null, "", "/execute?record=bad");
    view();
    expect(await screen.findByText("That saved run has no result that can be shown.")).toBeInTheDocument();
    expect(screen.queryByText("Saved run #9")).toBeNull();
    cleanup();
    window.history.replaceState(null, "", "/execute?record=rv");
    view();
    expect(await screen.findByText("That audit record is not a run of Execute & Audit SP.")).toBeInTheDocument();
    window.history.replaceState(null, "", "/execute");
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
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    await user.click(await screen.findByRole("tab", { name: "Raw output" }));
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
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
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
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
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
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "x");
    expect(screen.queryByRole("combobox", { name: "Database" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Database" })).toBeInTheDocument();
  });
});

describe("ExecutePage guided steps (EX-1 to EX-5)", () => {
  it("lays the page out as numbered steps and says why Execute is not ready", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    view();
    for (const name of ["Connect to Server", "What to run", "Run"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    const run = screen.getByRole("button", { name: /Execute & Audit/ });
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription("Connect and choose a database first.");

    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    // Stored procedure is the default choice.
    expect(screen.getByRole("radio", { name: "Stored procedure" })).toBeChecked();
    expect(run).toHaveAccessibleDescription("Enter the stored procedure name.");
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    expect(run).toHaveAccessibleDescription("Paste the SQL to run.");
    await user.click(screen.getByRole("radio", { name: "Stored procedure" }));
    await user.type(screen.getByLabelText("Procedure name"), "dbo.Get");
    expect(run).toBeEnabled();
  });

  it("folds the connection to one line after Connect, and Change opens it again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ databases: ["TestDB"] })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Database" }), { target: { value: "TestDB" } });

    expect(screen.getByText(/localhost · SQL login sa · 1 database/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect((screen.getByRole("combobox", { name: "Database" }) as HTMLSelectElement).value).toBe("TestDB");
  });

  it("shows a one-line result and the results in tabs", async () => {
    const analysis = {
      performanceGrade: "B", gradeRationale: "r", summary: "s",
      prodVerdict: { verdict: "READY", reason: "within targets", driver: null },
      ioAnalysis: { totalLogicalReads: 120, totalPhysicalReads: 0, totalScanCount: 1, hotTables: [] },
      timeAnalysis: { totalMs: 15, parseTimeMs: 1, executeTimeMs: 14, classification: "c", recommendation: "r" },
      prosAndCons: { pros: [], cons: [] }, recommendations: [],
    };
    const exec = { recordNumber: 7, connectionEngine: "simulation", executedAt: "n", success: true, spLabel: "SQL Batch", stats: { rawOutput: "Table 'T'. Scan count 1", simulated: true } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: { mode: "single", simulated: true, warnings: [], execution: exec, analysis } })));
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));

    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByLabelText("Result at a glance")).toHaveTextContent(/READY.*Grade B.*15 ms.*120 logical reads/);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Summary", "Recommendations", "Details", "Raw output", "Refactor"]);
    await user.click(screen.getByRole("tab", { name: "Raw output" }));
    expect(screen.getByText("Saved to the audit log as record #7.")).toBeInTheDocument();
  });

  it("labels each raw output in compare mode, and announces the finished run", async () => {
    const analysis = {
      performanceGrade: "A", gradeRationale: "r", summary: "s",
      ioAnalysis: { totalLogicalReads: 1, totalPhysicalReads: 0, totalScanCount: 1, hotTables: [] },
      timeAnalysis: { totalMs: 5, parseTimeMs: null, executeTimeMs: null, classification: "c", recommendation: "r" },
      prosAndCons: { pros: [], cons: [] }, recommendations: [],
    };
    const exec = { recordNumber: 9, connectionEngine: "simulation", executedAt: "n", success: true, spLabel: "SP", stats: { rawOutput: "raw", simulated: true } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: {
      mode: "compare", simulated: true, warnings: [],
      original: { execution: exec, analysis }, optimized: { execution: exec, analysis }, comparison: { ...analysis, improvementPercent: 5 },
    } })));
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("checkbox", { name: "Compare with an optimized version" }));
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.type(screen.getByPlaceholderText(/Paste your Optimized SP/), "select 2");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    expect(await screen.findByText("Run finished. Comparison ready.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Raw output" }));
    expect(screen.getByText("Original: raw execution output")).toBeInTheDocument();
    expect(screen.getByText("Optimized: raw execution output")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy optimized raw output" })).toBeInTheDocument();
  });

  it("folds the setup to one bar after a run, with Edit setup and Run again", async () => {
    const analysis = {
      performanceGrade: "C", gradeRationale: "r", summary: "s",
      planFindings: [{ kind: "cost-concentration", severity: "high", operator: "Scan", table: "Customers", message: "m", recommendation: "Add an index on Customers(RegionID)" }],
      ioAnalysis: { totalLogicalReads: 9000, totalPhysicalReads: 0, totalScanCount: 1, hotTables: [] },
      timeAnalysis: { totalMs: 50, parseTimeMs: 1, executeTimeMs: 49, classification: "c", recommendation: "r" },
      prosAndCons: { pros: [], cons: [] }, recommendations: ["Rewrite the cursor as a set-based query"],
    };
    const exec = { recordNumber: 11, connectionEngine: "simulation", executedAt: "n", success: true, spLabel: "SQL Batch", stats: { rawOutput: "raw", simulated: true } };
    // A fresh response per call: a body can be read only once.
    const fetchMock = vi.fn(async () => json({ result: { mode: "single", simulated: true, warnings: [], execution: exec, analysis } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));

    const bar = await screen.findByRole("region", { name: "Run setup" });
    expect(bar).toHaveTextContent("Simulation · SQL batch");
    expect(screen.queryByRole("heading", { name: "What to run" })).toBeNull();
    const top = screen.getByLabelText("Top recommendations");
    expect(top).toHaveTextContent("Add an index on Customers(RegionID)");
    expect(top).toHaveTextContent("Rewrite the cursor as a set-based query");

    await user.click(screen.getByRole("button", { name: "Run again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await user.click(await screen.findByRole("button", { name: "Edit setup" }));
    expect(screen.getByRole("heading", { name: "What to run" })).toBeInTheDocument();
  });

  it("lists the database's stored procedures once a database is chosen, and Refresh reloads them", async () => {
    let procs = ["dbo.usp_GetSummary", "sales.usp_Close"];
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/execute/procedures" ? json({ procedures: procs }) : json({ databases: ["TestDB"] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Database" }), { target: { value: "TestDB" } });

    expect(await screen.findByText(/2 stored procedures in this database/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/execute/procedures") as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string).connection).toMatchObject({ database: "TestDB" });
    // A selection box: the arrow opens the full list, typing filters it, choosing fills the name.
    const name = screen.getByRole("combobox", { name: "Procedure name" });
    await user.click(screen.getByRole("button", { name: "Show the stored procedures" }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["dbo.usp_GetSummary", "sales.usp_Close"]);
    await user.type(name, "close");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["sales.usp_Close"]);
    await user.click(screen.getByRole("option", { name: "sales.usp_Close" }));
    expect(name).toHaveValue("sales.usp_Close");

    // Typing into the closed box filters straight away, and a name that is not on the list is kept.
    await user.clear(name);
    fireEvent.keyDown(name, { key: "Escape" });
    await user.type(name, "s");
    expect(within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["dbo.usp_GetSummary", "sales.usp_Close"]);
    await user.type(name, "ales");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["sales.usp_Close"]);
    await user.clear(name);
    await user.type(name, "dbo.usp_NotListed");
    fireEvent.keyDown(name, { key: "Escape" });
    await user.click(screen.getByRole("heading", { name: "What to run" }));
    expect(name).toHaveValue("dbo.usp_NotListed");

    procs = ["dbo.usp_GetSummary", "sales.usp_Close", "dbo.usp_New"];
    await user.click(screen.getByRole("button", { name: "Refresh the stored procedure list" }));
    expect(await screen.findByText(/3 stored procedures in this database/)).toBeInTheDocument();
  });

  it("keeps the list of the database chosen last, even when an older reply arrives later", async () => {
    const replies: Record<string, (r: Response) => void> = {};
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/execute/procedures") return Promise.resolve(json({ databases: ["OldDB", "NewDB"] }));
      const db = JSON.parse(init?.body as string).connection.database as string;
      return new Promise<Response>((resolve) => { replies[db] = resolve; });
    }));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const picker = await screen.findByRole("combobox", { name: "Database" });
    fireEvent.change(picker, { target: { value: "OldDB" } });
    await user.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Database" }), { target: { value: "NewDB" } });

    await act(async () => { replies.NewDB(json({ procedures: ["dbo.new_a"] })); });
    await act(async () => { replies.OldDB(json({ procedures: ["dbo.old_a", "dbo.old_b"] })); });
    expect(screen.getByText(/1 stored procedures in this database/)).toBeInTheDocument();
    expect(screen.queryByText(/2 stored procedures in this database/)).toBeNull();
  });

  it("drops the list when switching to Simulation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/execute/procedures" ? json({ procedures: ["dbo.usp_A"] }) : json({ databases: ["TestDB"] })));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText(/^(Login|User name)$/), "sa");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Database" }), { target: { value: "TestDB" } });
    expect(await screen.findByText(/1 stored procedures in this database/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    expect(screen.queryByText(/stored procedures in this database/)).toBeNull();
    expect(screen.getByLabelText("Procedure name")).not.toHaveAttribute("list");
  });
});
