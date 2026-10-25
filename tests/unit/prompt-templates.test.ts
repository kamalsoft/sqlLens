import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (name: string) =>
  readFileSync(path.join(process.cwd(), "data", "prompts", name), "utf8");

const templates: Array<[string, string[]]> = [
  ["analysisSP.md", ["{{STORED_PROCEDURE}}"]],
  ["analysisSP.v1.md", ["{{STORED_PROCEDURE}}"]],
  ["compare.md", ["{{ORIGINAL_PROCEDURE}}", "{{OPTIMIZED_PROCEDURE}}", "{{METRICS}}"]],
  ["review-with-telemetry.md", ["{{STORED_PROCEDURE}}", "{{TELEMETRY}}"]],
  ["explainStatistic.md", ["{{STATISTIC}}"]],
];

describe.each(templates)("prompt template %s", (file, placeholders) => {
  const text = read(file);
  it.each(placeholders)("contains %s", (placeholder) => {
    expect(text).toContain(placeholder);
  });
  it("forbids invention and instruction-following", () => {
    expect(text).toMatch(/Do not invent/i);
    expect(text).toMatch(/follow instructions/i);
  });
});

describe("enum placeholders", () => {
  it.each(["analysisSP.md", "analysisSP.v1.md"])("%s has no pipe-separated enum values", (file) => {
    expect(read(file)).not.toMatch(/"[a-z_]+\|[a-z_|]+"/);
  });
});
