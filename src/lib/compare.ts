/** Model-based compare (P4-02): output schema, validator and prompt builder. */
import type { MetricComparison } from "@/lib/audit-analyzer";

export const COMPARE_SCHEMA_VERSION = "compare-v1";
export const COMPARE_WINNERS = ["original", "optimized", "inconclusive"] as const;
export type CompareWinner = (typeof COMPARE_WINNERS)[number];

export type CompareModelResult = {
  winner: CompareWinner;
  summary: string;
  differences: string[];
  risks: string[];
  confidence: number;
};

const MAX_TEXT = 4000;
const MAX_ITEMS = 50;

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > MAX_ITEMS) throw new Error(`${path} has too many items`);
  return value.map((item, i) => {
    if (typeof item !== "string") throw new Error(`${path}[${i}] must be a string`);
    return item.slice(0, MAX_TEXT);
  });
}

export function validateCompare(value: unknown): CompareModelResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("$ must be an object");
  }
  const c = value as Record<string, unknown>;
  if (!COMPARE_WINNERS.includes(c.winner as CompareWinner)) {
    throw new Error(`winner must be one of: ${COMPARE_WINNERS.join(", ")}`);
  }
  if (typeof c.summary !== "string" || !c.summary.trim()) {
    throw new Error("summary must be a non-empty string");
  }
  if (typeof c.confidence !== "number" || !(c.confidence >= 0 && c.confidence <= 1)) {
    throw new Error("confidence must be a number between 0 and 1");
  }
  return {
    winner: c.winner as CompareWinner,
    summary: c.summary.slice(0, MAX_TEXT),
    differences: stringList(c.differences, "differences"),
    risks: stringList(c.risks, "risks"),
    confidence: c.confidence,
  };
}

const PLACEHOLDER = /\{\{(ORIGINAL_PROCEDURE|OPTIMIZED_PROCEDURE|METRICS)\}\}/g;
export const MAX_COMPARE_PROMPT_CHARS = 60_000;

export class CompareTooLargeError extends Error {}

/** Single-pass substitution: SQL or metrics containing a placeholder are never re-expanded. */
export function buildComparePrompt(
  template: string,
  original: string,
  optimized: string,
  metrics: MetricComparison | null,
): string {
  for (const name of ["ORIGINAL_PROCEDURE", "OPTIMIZED_PROCEDURE", "METRICS"]) {
    if (!template.includes(`{{${name}}}`)) {
      throw new Error(`Compare prompt must contain {{${name}}}`);
    }
  }
  const prompt = template.replace(PLACEHOLDER, (_m, name: string) => {
    if (name === "ORIGINAL_PROCEDURE") return original;
    if (name === "OPTIMIZED_PROCEDURE") return optimized;
    return metrics
      ? JSON.stringify(metrics, null, 2)
      : "No execution metrics were provided; performance values were not captured.";
  });
  if (prompt.length > MAX_COMPARE_PROMPT_CHARS) {
    throw new CompareTooLargeError(`Compare prompt is too large: ${prompt.length} characters`);
  }
  return prompt;
}
