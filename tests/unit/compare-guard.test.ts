import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enforceMetricsRules, hasCapturedMetrics, validateCompare, type CompareModelResult } from "@/lib/compare";
import type { MetricComparison } from "@/lib/audit-analyzer";
import { extractJson } from "@/lib/extract-json";

const delta = { original: null, optimized: null };
const none = { logicalReads: delta, physicalReads: delta, scanCount: delta, cpu: delta, elapsed: delta } as unknown as MetricComparison;
const captured = { ...none, logicalReads: { original: 1200, optimized: 300 } } as unknown as MetricComparison;

const base: CompareModelResult = {
  winner: "optimized",
  summary: "The optimized version removes a temp table.",
  differences: ["Removes #StagedSales"],
  risks: [],
  confidence: 0.6,
};

describe("hasCapturedMetrics", () => {
  it("is false for null and for rows with no values", () => {
    expect(hasCapturedMetrics(null)).toBe(false);
    expect(hasCapturedMetrics(none)).toBe(false);
    expect(hasCapturedMetrics(captured)).toBe(true);
  });
});

describe("enforceMetricsRules", () => {
  it("forces inconclusive when no metrics were captured and makes no performance claim", () => {
    expect(enforceMetricsRules(base, null, false).winner).toBe("inconclusive");
    expect(enforceMetricsRules(base, none, false).winner).toBe("inconclusive");
  });

  it("rejects an invented percentage when no metrics were captured", () => {
    const invented = { ...base, differences: ["approximately 15-20% faster execution time"] };
    expect(() => enforceMetricsRules(invented, null, false)).toThrow(/without captured metrics/);
  });

  it("rejects units and speed words in summary or risks too", () => {
    expect(() => enforceMetricsRules({ ...base, summary: "Runs in 120 ms" }, null, false)).toThrow();
    expect(() => enforceMetricsRules({ ...base, risks: ["The new version is faster"] }, null, false)).toThrow();
  });

  it("keeps the model verdict when metrics were captured and not simulated", () => {
    const invented = { ...base, summary: "Reads 75% fewer pages" };
    expect(enforceMetricsRules(invented, captured, false)).toEqual(invented);
  });

  it("treats simulated telemetry as not measured", () => {
    expect(enforceMetricsRules(base, captured, true).winner).toBe("inconclusive");
  });

  it("applies to the failing output shape: a model that copies a placeholder and invents a percentage", () => {
    const raw = JSON.stringify({
      winner: "inconclusive",
      summary: "The original is heavier.",
      differences: ["a performance improvement of approximately 15-20% in execution time"],
      risks: [],
      confidence: 0.5,
    });
    expect(() => extractJson(raw, (v) => enforceMetricsRules(validateCompare(v), null, false))).toThrow();
  });
});

describe("compare prompt example", () => {
  const text = readFileSync(path.join(process.cwd(), "data", "prompts", "compare.md"), "utf8");

  it("has no angle-bracket placeholders to copy and says so", () => {
    const shape = text.slice(text.indexOf("{\n"), text.indexOf("}\n", text.indexOf("{\n")) + 2);
    expect(shape).not.toMatch(/[<>]/);
    expect(text).toContain("never copy them");
  });
});
