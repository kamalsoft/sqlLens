import { verifyIndexRecommendations } from "@/lib/index-recommendations";
import { missingDeclarations, newWriteTargets, procedureParameters, writeTargets } from "@/lib/rewrite-check";
import { asIndexRecommendations, asStringItems } from "@/lib/review-schema";
import { formatTsql } from "@/lib/sql-format";
import { looksLikeSql } from "@/lib/validation/sql-input";
import type { RefactorCheck, RefactorModelResult, RefactorResult, ViewRecommendation } from "@/lib/refactor-shared";

export const MAX_REFACTOR_PROMPT_CHARS = 60_000;

export * from "@/lib/refactor-shared";

export class RefactorTooLargeError extends Error {}

const PLACEHOLDER = /\{\{(STORED_PROCEDURE|USER_INSTRUCTIONS)\}\}/g;

/** Single-pass substitution; user text cannot close or open the prompt's tags. */
export function buildRefactorPrompt(template: string, sql: string, instructions: string): string {
  if (!template.includes("{{STORED_PROCEDURE}}") || !template.includes("{{USER_INSTRUCTIONS}}")) {
    throw new Error("Refactor prompt must contain {{STORED_PROCEDURE}} and {{USER_INSTRUCTIONS}}");
  }
  const safeInstructions =
    instructions.replace(/<\/?\s*(user_instructions|stored_procedure|rewritten_procedure)\s*>/gi, "[tag removed]").trim() ||
    "(none)";
  const prompt = template.replace(PLACEHOLDER, (_m, name: string) =>
    name === "USER_INSTRUCTIONS"
      ? safeInstructions
      : ["<stored_procedure>", sql, "</stored_procedure>"].join("\n"),
  );
  if (prompt.length > MAX_REFACTOR_PROMPT_CHARS) {
    throw new RefactorTooLargeError(`Refactor prompt is too large: ${prompt.length} characters`);
  }
  return prompt;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function validateRefactor(value: unknown): RefactorModelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("$: must be an object");
  const c = value as Record<string, unknown>;
  if (typeof c.summary !== "string" || !c.summary.trim()) throw new Error("summary: must be a string");
  const views = Array.isArray(c.viewRecommendations) ? c.viewRecommendations : [];
  return {
    summary: c.summary,
    changes: asStringItems(c.changes, "changes"),
    indexRecommendations: asIndexRecommendations(c.indexRecommendations),
    viewRecommendations: views
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
      .map((v) => ({ name: asText(v.name).trim(), reason: asText(v.reason), definition: asText(v.definition).trim() })),
    otherRecommendations: asStringItems(c.otherRecommendations, "otherRecommendations"),
    limitations: asStringItems(c.limitations, "limitations"),
  };
}

const VIEW_NAME = /^(?:\[[^\].\r\n]{1,128}\]|[A-Za-z_]\w{0,127})(?:\.(?:\[[^\].\r\n]{1,128}\]|[A-Za-z_]\w{0,127}))?$/;
const bracket = (part: string) => `[${part.replace(/^\[|\]$/g, "").replace(/]/g, "]]")}]`;

/**
 * Keeps a view only when its name is a safe identifier and its definition is a
 * single read-only SELECT over tables the original SQL uses; adds the DDL.
 */
export function verifyViewRecommendations(
  items: ViewRecommendation[],
  sql: string,
): { kept: ViewRecommendation[]; removed: number } {
  const used = new Set(
    [...sql.matchAll(/\b(?:from|join)\s+((?:\[?\w+\]?\.){0,2}\[?\w+\]?)/gi)].map((m) =>
      m[1].split(".").pop()!.replace(/^\[|\]$/g, "").toLowerCase(),
    ),
  );
  const kept: ViewRecommendation[] = [];
  for (const view of items.slice(0, 3)) {
    const definition = view.definition.replace(/;\s*$/, "").trim();
    const sources = [...definition.matchAll(/\b(?:from|join)\s+((?:\[?\w+\]?\.){0,2}\[?[#@]?\w+\]?)/gi)].map((m) =>
      m[1].split(".").pop()!.replace(/^\[|\]$/g, "").toLowerCase(),
    );
    const valid =
      VIEW_NAME.test(view.name) &&
      /^(select|with)\b/i.test(definition) &&
      !definition.includes(";") &&
      !/@|#|\border\s+by\b/i.test(definition) &&
      writeTargets(definition).size === 0 &&
      sources.length > 0 &&
      sources.every((t) => used.has(t));
    if (!valid) continue;
    const body = formatTsql(definition).text;
    kept.push({ ...view, definition: body, createStatement: `CREATE VIEW ${view.name.split(".").map(bracket).join(".")}\nAS\n${body};` });
  }
  return { kept, removed: items.length - kept.length };
}

/** Static checks shown as the refactor's lint results. */
export function refactorChecks(original: string, refactored: string, formatted: boolean): RefactorCheck[] {
  const missing = missingDeclarations(original, refactored);
  const before = procedureParameters(original);
  const after = procedureParameters(refactored);
  const sameParams = before.length === after.length && before.every((p, i) => p === after[i]);
  return [
    { id: "sql", label: "Reads as T-SQL", passed: looksLikeSql(refactored) },
    {
      id: "declarations",
      label: "Every variable and temp table is declared",
      passed: missing.length === 0,
      ...(missing.length ? { detail: `Not declared or created: ${missing.join(", ")}` } : {}),
    },
    {
      id: "parameters",
      label: "Same parameters as the original",
      passed: sameParams,
      ...(sameParams ? {} : { detail: `Original: ${before.join(", ") || "none"}; refactored: ${after.join(", ") || "none"}` }),
    },
    { id: "nolock", label: "No NOLOCK hints", passed: !/\bnolock\b/i.test(refactored.replace(/--[^\n]*/g, "")) },
    { id: "format", label: "Formatted without changing the SQL", passed: formatted },
  ];
}

/** Turns the parsed answer and the SQL block into the result the page shows. */
export function finishRefactor(
  model: RefactorModelResult,
  original: string,
  block: { rewrite: string | null; closed: boolean },
  hitTokenLimit: boolean,
): RefactorResult {
  const indexes = verifyIndexRecommendations(model.indexRecommendations, original);
  const views = verifyViewRecommendations(model.viewRecommendations, original);
  const limitations = [...model.limitations];
  if (indexes.removed > 0) limitations.push(`${indexes.removed} index recommendation(s) removed: table or columns not found in the SQL.`);
  if (views.removed > 0) limitations.push(`${views.removed} view recommendation(s) removed: not a read-only SELECT over tables in the SQL.`);
  const base = { ...model, indexRecommendations: indexes.kept, viewRecommendations: views.kept, limitations };

  const raw = (block.rewrite ?? "").replace(/^\s*```[a-z]*\s*$/gim, "").trim();
  if (block.rewrite !== null && !block.closed && hitTokenLimit) {
    return { ...base, status: "truncated", refactoredSql: "", formatted: false, checks: [] };
  }
  if (!raw) return { ...base, status: "none", refactoredSql: "", formatted: false, checks: [] };

  const added = newWriteTargets(original, raw);
  if (added.length > 0) {
    return { ...base, status: "unsafe", statusDetail: `Writes to ${added.join(", ")}`, refactoredSql: "", formatted: false, checks: [] };
  }
  const { text, formatted } = formatTsql(raw);
  return { ...base, status: "provided", refactoredSql: text, formatted, checks: refactorChecks(original, text, formatted) };
}
