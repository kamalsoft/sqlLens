/**
 * Normalizes stored execution telemetry for the review prompt (P4-01).
 * null = not captured; values are never estimated. Raw output and log text
 * are omitted: they are large and may contain data.
 */

const MAX_IO_ROWS = 50;
const MAX_PLAN_CHARS = 4000;

export type NormalizedTelemetry = {
  simulated: boolean;
  parseAndCompileMs: number | null;
  parseAndCompileCpuMs: number | null;
  executionMs: number | null;
  executionCpuMs: number | null;
  totalElapsedMs: number | null;
  io: {
    table: string;
    scanCount: number;
    logicalReads: number;
    physicalReads: number;
  }[];
  plan: string | null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pulls the ExecutionResult.stats of the (first) run out of a persisted EXECUTE / EXECUTE_COMPARE response. */
export function statsFromAuditResponse(
  response: unknown,
  side: "original" | "optimized" = "original",
): Record<string, unknown> | null {
  if (!isObject(response)) return null;
  const holder = isObject(response[side]) ? response[side] : response;
  const execution = isObject(holder) && isObject(holder.execution) ? holder.execution : null;
  if (!execution || !isObject(execution.stats)) return null;
  const stats = execution.stats;
  if (!Array.isArray(stats.io) || typeof stats.simulated !== "boolean") return null;
  return stats;
}

export function normalizeTelemetry(stats: Record<string, unknown>): NormalizedTelemetry {
  const io = Array.isArray(stats.io) ? stats.io : [];
  return {
    simulated: stats.simulated === true,
    parseAndCompileMs: num(stats.parseAndCompileTime),
    parseAndCompileCpuMs: num(stats.parseAndCompileCpu),
    executionMs: num(stats.executionTime),
    executionCpuMs: num(stats.executionCpu),
    totalElapsedMs: num(stats.totalElapsedMs),
    io: io
      .filter(isObject)
      .slice(0, MAX_IO_ROWS)
      .map((row) => ({
        table: String(row.table ?? "").slice(0, 200),
        scanCount: num(row.scanCount) ?? 0,
        logicalReads: num(row.logicalReads) ?? 0,
        physicalReads: num(row.physicalReads) ?? 0,
      })),
    plan: typeof stats.plan === "string" ? stats.plan.slice(0, MAX_PLAN_CHARS) : null,
  };
}

const PLACEHOLDER = /\{\{(TELEMETRY|STORED_PROCEDURE)\}\}/g;
export const MAX_TELEMETRY_PROMPT_CHARS = 40_000;

/** Single-pass substitution so inserted SQL or telemetry is never re-expanded. */
export function buildTelemetryPrompt(
  template: string,
  sql: string,
  telemetry: NormalizedTelemetry,
): string {
  if (!template.includes("{{TELEMETRY}}") || !template.includes("{{STORED_PROCEDURE}}")) {
    throw new Error("Telemetry prompt must contain {{TELEMETRY}} and {{STORED_PROCEDURE}}");
  }
  const prompt = template.replace(PLACEHOLDER, (_m, name: string) =>
    name === "TELEMETRY"
      ? JSON.stringify(telemetry, null, 2)
      : ["<stored_procedure>", sql, "</stored_procedure>"].join("\n"),
  );
  if (prompt.length > MAX_TELEMETRY_PROMPT_CHARS) {
    throw new Error(`Analysis prompt is too large: ${prompt.length} characters`);
  }
  return prompt;
}
