// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
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
    fireEvent.change(screen.getByLabelText("Parameter 1 type"), { target: { value: "int" } });
    await user.type(screen.getByLabelText("Parameter 1 value"), "abc");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("must be a number");
  });

  it("tests a live connection via /api/connections/test", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, serverVersion: "16.0" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByRole("combobox", { name: "" }), { target: { value: "mssql" } });
    await user.type(screen.getByPlaceholderText("MyDatabase"), "db");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/connections/test");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).engine).toBe("mssql");
    expect(await screen.findByText(/Connected: 16.0/)).toBeInTheDocument();
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

  it("blocks an empty port without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    view();
    fireEvent.change(screen.getByRole("combobox", { name: "" }), { target: { value: "mssql" } });
    await user.type(screen.getByPlaceholderText("MyDatabase"), "db");
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.clear(screen.getByLabelText("Port"));
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Port must be");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
