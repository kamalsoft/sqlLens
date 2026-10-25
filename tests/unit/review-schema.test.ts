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
  it("defaults absent optional fields conservatively", () => {
    const issue = { ...v1.issues[0], recommendation: undefined };
    const result = validateReviewV1({ summary: v1.summary, issues: [issue] });
    expect(result.rewrittenProcedure).toBe("");
    expect(result.confidence).toBe(0);
    expect(result.issues[0].recommendation).toBe("");
  });
  it("defaults indexRecommendations to [] and validates its rows", () => {
    expect(validateReviewV1(v1).indexRecommendations).toEqual([]);
    const row = { table: "dbo.t", keyColumns: ["a"] };
    expect(validateReviewV1({ ...v1, indexRecommendations: [row] }).indexRecommendations).toEqual([
      { table: "dbo.t", keyColumns: ["a"], includeColumns: [], reason: "", evidence: "" },
    ]);
    expect(() => validateReviewV1({ ...v1, indexRecommendations: [{ table: "t", keyColumns: "a" }] })).toThrow(
      /indexRecommendations\[0\]\.keyColumns/,
    );
  });

  it("still rejects present-but-wrong optional fields", () => {
    expect(() => validateReviewV1({ ...v1, rewrittenProcedure: 5 })).toThrow(/rewrittenProcedure/);
    expect(() => validateReviewV1({ ...v1, confidence: "high" })).toThrow(/confidence/);
    expect(() => validateReviewV1({ ...v1, issues: undefined })).toThrow(/^issues:/);
  });
});

describe("review schema v2", () => {
  it("accepts a valid fixture", () => {
    expect(validateReviewV2(v2).overallRisk).toBe("medium");
    expect(validateReview("v2", v2)).toEqual({ ...v2, indexRecommendations: [], rewriteNotes: [] });
  });
  it("rejects a v1 payload", () => {
    expect(() => validateReview("v2", v1)).toThrow(/overallRisk/);
    expect(() => validateReview("v1", v2)).toThrow(/issues/);
  });
  it("drops malformed rows with a limitation instead of failing the review", () => {
    const out = validateReviewV2({
      ...v2,
      findingsTable: [{ ...v2.findingsTable[0], category: "x" }, { ...v2.findingsTable[0], severity: undefined }],
      performanceTable: [{ ...v2.performanceTable[0], impact: "huge" }],
      securityTable: [{ ...v2.securityTable[0], area: "x" }],
      testingTable: [{ test: "t" }],
      limitations: [3, "kept"],
    });
    expect(out.findingsTable).toEqual([]);
    expect(out.performanceTable).toEqual([]);
    expect(out.securityTable).toEqual([]);
    expect(out.testingTable).toEqual([]);
    expect(out.limitations).toEqual(["kept", "5 row(s) removed because they did not match the review schema."]);
  });
  it("normalizes enum spelling and defaults missing tables and recommendations", () => {
    const out = validateReviewV2({
      summary: v2.summary,
      overallRisk: v2.overallRisk,
      findingsTable: [{ ...v2.findingsTable[0], category: "Error Handling", recommendation: undefined }],
    });
    expect(out.findingsTable[0]).toMatchObject({ category: "error_handling", recommendation: "" });
    expect(out.performanceTable).toEqual([]);
    expect(out.securityTable).toEqual([]);
  });
  it("still fails on structural errors", () => {
    expect(() => validateReviewV2({ ...v2, findingsTable: "x" })).toThrow(/findingsTable: must be an array/);
    expect(() => validateReviewV2({ ...v2, overallRisk: "severe" })).toThrow(/overallRisk/);
    expect(() => validateReviewV2({ ...v2, summary: undefined })).toThrow(/summary/);
  });
});
