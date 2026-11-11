// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("@/components/api-client", () => ({ useApi: () => apiGet }));

import SharePage from "@/app/share/[token]/page";
import { CompareVerdict } from "@/components/compare/CompareVerdict";

const verdict = {
  winner: "optimized" as const,
  summary: "The improved SP reads fewer pages.",
  differences: ["Adds a temp table"],
  risks: ["Temp table adds tempdb use"],
  confidence: 0.7,
};

const metrics = {
  logicalReads: { original: 1200, optimized: 300 },
  physicalReads: { original: null, optimized: null },
  scanCount: { original: 4, optimized: 1 },
  cpu: { original: null, optimized: null },
  elapsed: { original: null, optimized: null },
} as never;

const wrap = (ui: React.ReactElement) => <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>;

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("CompareVerdict", () => {
  it("shows the winner, confidence, differences, risks and captured metrics", () => {
    render(wrap(<CompareVerdict result={verdict} metrics={metrics} />));
    expect(screen.getByTestId("compare-winner").textContent).toBe("Improved SP is better");
    expect(screen.getByText("Confidence 70%")).toBeTruthy();
    expect(screen.getByText("Adds a temp table")).toBeTruthy();
    expect(screen.getByText("Temp table adds tempdb use")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Execution metrics" });
    expect(table.textContent).toContain("Logical reads");
    expect(table.textContent).toContain("1200");
    expect(table.textContent).not.toContain("Physical reads");
  });

  it("says metrics were not captured when every value is null", () => {
    render(wrap(<CompareVerdict result={verdict} metrics={null} />));
    expect(screen.queryByRole("table", { name: "Execution metrics" })).toBeNull();
    expect(screen.getByText(/Not captured/)).toBeTruthy();
  });
});

describe("share page for a compare-v1 result", () => {
  it("renders the verdict instead of the old original/optimized pair", async () => {
    apiGet.mockResolvedValue({
      ok: true,
      status: 200,
      error: null,
      field: null,
      details: null,
      data: { type: "COMPARE", result: { result: verdict, metrics } },
    });
    render(wrap(<SharePage params={Promise.resolve({ token: "abc" })} />));
    expect(await screen.findByTestId("compare-winner")).toBeTruthy();
    expect(screen.getByText("The improved SP reads fewer pages.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
