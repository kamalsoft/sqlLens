import { describe, expect, it } from "vitest";
import {
  validateReview,
  validateReviewV1,
  validateReviewV2,
} from "@/lib/review-schema";

const v1 = {
  summary: "ok",
  issues: [{ severity: "High", title: "t", explanation: "e", recommendation: "r" }],
  rewrittenProcedure: "CREATE PROC x AS SELECT 1",
  confidence: 0.7,
};

const v2 = {
  summary: "ok",
  overallRisk: "medium",
  confidence: 0.5,
  findingsTable: [
    { category: "performance", finding: "f", evidence: "e", severity: "low", recommendation: "r" },
  ],
  performanceTable: [
    { area: "joins", observation: "o", evidence: "e", impact: "unknown", recommendation: "r" },
  ],
  securityTable: [
    { area: "dynamic_sql", observation: "o", evidence: "e", risk: "high", recommendation: "r" },
  ],
  testingTable: [{ test: "t", purpose: "p", expectedResult: "x" }],
  rewrittenProcedure: "SELECT 1",
  limitations: ["no plan"],
};

describe("review schema v1", () => {
  it("accepts a valid fixture and lowercases severity", () => {
    expect(validateReviewV1(v1).issues[0].severity).toBe("high");
  });
  it("reports field paths", () => {
    expect(() => validateReviewV1({ ...v1, summary: 1 })).toThrow(/^summary:/);
    expect(() =>
      validateReviewV1({ ...v1, issues: [{ ...v1.issues[0], severity: "bad" }] }),
    ).toThrow(/issues\[0\]\.severity/);
    expect(() => validateReviewV1({ ...v1, confidence: 2 })).toThrow(/confidence/);
    expect(() => validateReviewV1(null)).toThrow(/\$/);
  });
});

describe("review schema v2", () => {
  it("accepts a valid fixture", () => {
    expect(validateReviewV2(v2).overallRisk).toBe("medium");
    expect(validateReview("v2", v2)).toEqual(v2);
  });
  it("rejects a v1 payload", () => {
    expect(() => validateReview("v2", v1)).toThrow(/overallRisk/);
    expect(() => validateReview("v1", v2)).toThrow(/issues/);
  });
  it("reports nested field paths", () => {
    expect(() =>
      validateReviewV2({ ...v2, findingsTable: [{ ...v2.findingsTable[0], category: "x" }] }),
    ).toThrow(/findingsTable\[0\]\.category/);
    expect(() =>
      validateReviewV2({ ...v2, performanceTable: [{ ...v2.performanceTable[0], impact: "huge" }] }),
    ).toThrow(/performanceTable\[0\]\.impact/);
    expect(() =>
      validateReviewV2({ ...v2, securityTable: [{ ...v2.securityTable[0], area: "x" }] }),
    ).toThrow(/securityTable\[0\]\.area/);
    expect(() =>
      validateReviewV2({ ...v2, testingTable: [{ test: "t" }] }),
    ).toThrow(/testingTable\[0\]\.purpose/);
    expect(() => validateReviewV2({ ...v2, limitations: [3] })).toThrow(/limitations\[0\]/);
    expect(() => validateReviewV2({ ...v2, overallRisk: "severe" })).toThrow(/overallRisk/);
  });
});
