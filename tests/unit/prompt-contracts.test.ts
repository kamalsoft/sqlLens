import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCompare } from "@/lib/compare";
import { buildPrompt } from "@/lib/review-prompt";
import { validateReviewV1, validateReviewV2 } from "@/lib/review-schema";

const read = (name: string) => readFileSync(path.join(process.cwd(), "data", "prompts", name), "utf8");

/** The example object: from a line that is exactly "{" to the next line that is exactly "}". */
function example(text: string): Record<string, unknown> {
  const match = text.match(/^\{\n[\s\S]*?\n\}$/m);
  if (!match) throw new Error("no example object");
  return JSON.parse(match[0]);
}

/** "- findingsTable[].category: a, b" -> { "findingsTable[].category": ["a", "b"] } */
function allowedValues(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [, field, values] of text.matchAll(/^- ([\w[\].]+): ([a-z_, ]+)$/gm)) {
    out[field] = values.split(",").map((v) => v.trim());
  }
  return out;
}

// A valid row per table, so each test varies only the field under test.
const FILLER: Record<string, Record<string, string>> = {
  findingsTable: { category: "performance", finding: "f", evidence: "e", severity: "low", recommendation: "r" },
  performanceTable: { area: "io", observation: "o", evidence: "e", impact: "low", recommendation: "r" },
  securityTable: { area: "permissions", observation: "o", evidence: "e", risk: "low", recommendation: "r" },
};

const V2_PROMPTS = ["analysisSP.md", "analysisSP-verylarge.md", "review-with-telemetry.md"];

describe("prompt contracts", () => {
  it.each([...V2_PROMPTS, "analysisSP.v1.md"])("%s has the placeholder, no fences, and builds", (name) => {
    const text = read(name);
    expect(text).toContain("{{STORED_PROCEDURE}}");
    expect(text).not.toContain("```");
    expect(text).toMatch(/Return the keys in this order: [^\n]*indexRecommendations, rewriteNotes\./);
    // The rewrite is plain SQL after the JSON, never a JSON string.
    expect(text).toMatch(/\n\}\n<rewritten_procedure>\n[^\n]+\n<\/rewritten_procedure>/);
    expect(text).not.toContain('"rewrittenProcedure"');
    expect(text).toContain("Do not write CREATE INDEX statements");
    if (name !== "review-with-telemetry.md") expect(() => buildPrompt(text, "SELECT 1")).not.toThrow();
  });

  it("review-with-telemetry.md has the telemetry placeholder", () => {
    expect(read("review-with-telemetry.md")).toContain("{{TELEMETRY}}");
  });

  it("v1 example validates and does not prime a dynamic-SQL finding", () => {
    const text = read("analysisSP.v1.md");
    expect(() => validateReviewV1(example(text))).not.toThrow();
    expect(JSON.stringify(example(text))).not.toMatch(/sp_executesql|EXEC\(|injection/i);
  });

  it.each(V2_PROMPTS)("%s example validates and every allowed enum value is accepted", (name) => {
    const text = read(name);
    const base = example(text);
    expect(() => validateReviewV2(base)).not.toThrow();
    expect(JSON.stringify(base)).not.toMatch(/sp_executesql|EXEC\(|injection/i);

    const allowed = allowedValues(text);
    expect(Object.keys(allowed).length).toBeGreaterThanOrEqual(7);
    for (const [field, values] of Object.entries(allowed)) {
      const [table, key] = field.includes("[].") ? field.split("[].") : [null, field];
      for (const value of values) {
        const candidate = table
          ? { ...base, [table]: [{ ...FILLER[table], [key]: value }] }
          : { ...base, [key]: value };
        expect(() => validateReviewV2(candidate), `${name} ${field}=${value}`).not.toThrow();
      }
    }
  });

  it("compare.md has its placeholders and a neutral, valid example", () => {
    const text = read("compare.md");
    for (const p of ["{{ORIGINAL_PROCEDURE}}", "{{OPTIMIZED_PROCEDURE}}", "{{METRICS}}"]) expect(text).toContain(p);
    const ex = example(text);
    expect(() => validateCompare(ex)).not.toThrow();
    expect(ex.winner).toBe("inconclusive");
  });
});
