// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "./user";

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result }), { status: 200, headers: { "content-type": "application/json" } })
    ));
    const user = userEvent.setup();
    render(<ChakraProvider value={defaultSystem}><ExecutePage /></ChakraProvider>);
    await user.type(screen.getByPlaceholderText(/Paste your Stored Procedure/), "select 1");
    await user.click(screen.getByRole("button", { name: /Execute & Audit/ }));

    // P8-04: the grade badge reads "Not graded" when the grade is withheld, so one fewer "Not captured".
    expect((await screen.findAllByText("Not captured")).length).toBe(4);
    expect(screen.getByText("Not graded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("Simulated")).toBeInTheDocument();
  });
});
