import { describe, expect, it } from "vitest";
import { MAX_EVIDENCE_CHARS, dropUnsupportedEvidence } from "@/lib/review-evidence";
import type { ReviewV2 } from "@/lib/review-schema";

const sql = "CREATE PROCEDURE dbo.P AS BEGIN\n  SELECT  Id FROM dbo.Orders WITH (NOLOCK);\nEND";

function review(): ReviewV2 {
  return {
    summary: "s",
    overallRisk: "low",
    confidence: 0.5,
    findingsTable: [
      { category: "security", finding: "copied", evidence: "EXEC(@sql)", severity: "high", recommendation: "r" },
      { category: "concurrency", finding: "nolock", evidence: "WITH (NOLOCK)", severity: "medium", recommendation: "r" },
    ],
    performanceTable: [
      { area: "io", observation: "o", evidence: "select id from DBO.orders", impact: "low", recommendation: "r" },
    ],
    securityTable: [
      { area: "permissions", observation: "o", evidence: "Not observed", risk: "unknown", recommendation: "r" },
    ],
    testingTable: [],
    rewrittenProcedure: "",
    limitations: [],
    indexRecommendations: [],
    rewriteNotes: [],
  };
}

describe("dropUnsupportedEvidence", () => {
  it("drops rows whose evidence is not in the SQL and notes it", () => {
    const out = dropUnsupportedEvidence(review(), sql);
    expect(out.findingsTable.map((f) => f.finding)).toEqual(["nolock"]);
    expect(out.performanceTable).toHaveLength(1);
    expect(out.securityTable).toHaveLength(1);
    expect(out.limitations).toEqual([
      "1 item(s) removed because their evidence was not found in the submitted procedure.",
    ]);
  });

  it("leaves limitations alone when nothing is removed", () => {
    const input = review();
    input.findingsTable = input.findingsTable.slice(1);
    expect(dropUnsupportedEvidence(input, sql).limitations).toEqual([]);
  });

  it("accepts an abbreviated quote whose fragments appear in order", () => {
    const procSql = "BEGIN TRY\n  SELECT a FROM t WITH (NOLOCK);\nEND TRY\nBEGIN CATCH\n  THROW;\nEND CATCH";
    const row = (evidence: string) => ({ ...review(), findingsTable: [{ ...review().findingsTable[0], evidence }], performanceTable: [], securityTable: [] });
    expect(dropUnsupportedEvidence(row("BEGIN TRY...END TRY...BEGIN CATCH..."), procSql).findingsTable).toHaveLength(1);
    expect(dropUnsupportedEvidence(row("SELECT… WITH (NOLOCK)…"), procSql).findingsTable).toHaveLength(1);
    // Out of order, invented, or too little quoted text is still dropped.
    expect(dropUnsupportedEvidence(row("END CATCH...BEGIN TRY"), procSql).findingsTable).toHaveLength(0);
    expect(dropUnsupportedEvidence(row("BEGIN TRY...ROLLBACK"), procSql).findingsTable).toHaveLength(0);
    expect(dropUnsupportedEvidence(row("SELECT..."), procSql).findingsTable).toHaveLength(0);
  });

  it("drops empty evidence", () => {
    const input = review();
    input.findingsTable[1].evidence = "  ";
    expect(dropUnsupportedEvidence(input, sql).findingsTable).toHaveLength(0);
  });
});

describe("evidence tidying (RJ-2)", () => {
  it("strips code fences, keeps quotes from the SQL, and shortens long ones", () => {
    const longSql = "CREATE PROCEDURE dbo.P AS BEGIN\n" + "  SELECT Id FROM dbo.Orders WITH (NOLOCK);\n".repeat(20) + "END";
    const r = review();
    r.findingsTable = [
      { category: "concurrency", finding: "fenced", evidence: "```sql\nWITH (NOLOCK)\n```", severity: "low", recommendation: "r" },
      { category: "maintainability", finding: "whole procedure", evidence: longSql, severity: "low", recommendation: "r" },
    ];
    const out = dropUnsupportedEvidence(r, longSql);
    expect(out.findingsTable.map((row) => row.finding)).toEqual(["fenced", "whole procedure"]);
    expect(out.findingsTable[0].evidence).toBe("WITH (NOLOCK)");
    const shortened = out.findingsTable[1].evidence;
    expect(shortened.length).toBe(MAX_EVIDENCE_CHARS + 1);
    expect(shortened.endsWith("…")).toBe(true);
  });
});
