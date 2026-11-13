// @vitest-environment jsdom
import { fireEvent, cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";
import { typeSql } from "./sql-box";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/execute" }));

import ExecutePage from "@/app/execute/page";

const result = {
  mode: "single",
  execution: {
    recordNumber: 1, connectionEngine: "simulation", executedAt: "now", success: true,
    spLabel: "SP", stats: { rawOutput: "raw", simulated: true },
  },
  analysis: {
    performanceGrade: null, gradeRationale: "n/a", summary: "s",
    ioAnalysis: { totalLogicalReads: null, totalPhysicalReads: null, totalScanCount: null, hotTables: [] },
    timeAnalysis: { totalMs: null, parseTimeMs: 0, executeTimeMs: 0, classification: "", recommendation: "" },
    prosAndCons: { pros: [], cons: [] }, recommendations: [],
  },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ExecutePage null metrics", () => {
  it("renders Not captured and the Simulated badge", async () => {
    // A fresh Response per call: the page also loads /api/appconfig (SEC-T5).
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ result }), { status: 200, headers: { "content-type": "application/json" } })
    ));
    const user = userEvent.setup();
    render(<ChakraProvider value={defaultSystem}><ExecutePage /></ChakraProvider>);
    fireEvent.change(screen.getByLabelText("Server type"), { target: { value: "simulation" } });
    await user.click(screen.getByRole("radio", { name: "SQL batch" }));
    await typeSql("Original SQL", "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));

    // P8-04: the grade badge reads "Not graded" when the grade is withheld, so one fewer "Not captured".
    expect((await screen.findAllByText("Not captured")).length).toBe(4);
    expect(screen.getAllByText("Not graded").length).toBeGreaterThan(0);
    expect(screen.getByText("Simulated")).toBeInTheDocument();
  });
});
