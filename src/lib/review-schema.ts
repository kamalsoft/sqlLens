export type SchemaVersion = "v1" | "v2";

export const DEFAULT_SCHEMA_VERSION: SchemaVersion = "v2";

export function isSchemaVersion(value: unknown): value is SchemaVersion {
  return value === "v1" || value === "v2";
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const RISKS = ["low", "medium", "high", "critical"] as const;
const FINDING_CATEGORIES = [
  "correctness",
  "performance",
  "security",
  "concurrency",
  "maintainability",
  "standards",
  "error_handling",
  "transactional_integrity",
] as const;
const PERFORMANCE_AREAS = [
  "query_shape",
  "joins",
  "filters",
  "aggregation",
  "indexing",
  "parameter_sniffing",
  "tempdb",
  "cursor_loop",
  "io",
] as const;
const IMPACTS = ["low", "medium", "high", "unknown"] as const;
const SECURITY_AREAS = [
  "dynamic_sql",
  "injection",
  "permissions",
  "data_exposure",
  "input_validation",
] as const;

/**
 * A suggested nonclustered index. The model proposes table and columns; the
 * route keeps it only when they appear in the SQL and adds `createStatement`.
 */
export type IndexRecommendation = {
  table: string;
  keyColumns: string[];
  includeColumns: string[];
  reason: string;
  evidence: string;
  createStatement?: string;
};

/**
 * Server-set outcome of the rewrite: provided, none (model returned ""),
 * invalid (not SQL, removed), unsafe (writes to tables the original does not,
 * removed; `rewriteDetail` names them) or truncated (cut off by the token
 * limit, removed).
 */
export type RewriteStatus = "provided" | "none" | "invalid" | "unsafe" | "truncated";

export type ReviewV1 = {
  summary: string;
  issues: Array<{
    severity: (typeof SEVERITIES)[number];
    title: string;
    explanation: string;
    recommendation: string;
  }>;
  rewrittenProcedure: string;
  confidence: number;
  indexRecommendations: IndexRecommendation[];
  rewriteNotes: string[];
  rewriteStatus?: RewriteStatus;
  rewriteDetail?: string;
};

export type ReviewV2 = {
  summary: string;
  overallRisk: (typeof RISKS)[number];
  confidence: number;
  findingsTable: Array<{
    category: (typeof FINDING_CATEGORIES)[number];
    finding: string;
    evidence: string;
    severity: (typeof SEVERITIES)[number];
    recommendation: string;
  }>;
  performanceTable: Array<{
    area: (typeof PERFORMANCE_AREAS)[number];
    observation: string;
    evidence: string;
    impact: (typeof IMPACTS)[number];
    recommendation: string;
  }>;
  securityTable: Array<{
    area: (typeof SECURITY_AREAS)[number];
    observation: string;
    evidence: string;
    risk: (typeof IMPACTS)[number];
    recommendation: string;
  }>;
  testingTable: Array<{
    test: string;
    purpose: string;
    expectedResult: string;
  }>;
  rewrittenProcedure: string;
  limitations: string[];
  indexRecommendations: IndexRecommendation[];
  rewriteNotes: string[];
  rewriteStatus?: RewriteStatus;
  rewriteDetail?: string;
};

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function asConfidence(value: unknown, path: string): number {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
    fail(path, "must be a number between 0 and 1");
  }
  return n;
}

/**
 * Small models often omit trailing fields. Absent (undefined/null) optional
 * fields get a conservative default; present-but-wrong values still fail.
 * Confidence defaults to 0 so an incomplete answer never looks trustworthy.
 */
function orDefault<T>(value: unknown, fallback: T, parse: (value: unknown) => T): T {
  return value === undefined || value === null ? fallback : parse(value);
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  // "Error Handling" / "error-handling" -> "error_handling"
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!(allowed as readonly string[]).includes(normalized)) {
    fail(path, `must be one of ${allowed.join("|")} (got ${JSON.stringify(value)})`);
  }
  return normalized as T;
}

function asStringList(value: unknown, path: string): string[] {
  return asArray(value, path).map((v, i) => asString(v, `${path}[${i}]`));
}

function asRewriteNotes(value: unknown): string[] {
  return orDefault<unknown[]>(value, [], (v) => asArray(v, "rewriteNotes")).filter(
    (note): note is string => typeof note === "string" && note.trim().length > 0,
  );
}

function asIndexRecommendations(value: unknown): IndexRecommendation[] {
  return orDefault<unknown[]>(value, [], (v) => asArray(v, "indexRecommendations")).map((raw, i) => {
    const p = `indexRecommendations[${i}]`;
    const r = asObject(raw, p);
    return {
      table: asString(r.table, `${p}.table`),
      keyColumns: asStringList(r.keyColumns, `${p}.keyColumns`),
      includeColumns: orDefault(r.includeColumns, [], (v) => asStringList(v, `${p}.includeColumns`)),
      reason: orDefault(r.reason, "", (v) => asString(v, `${p}.reason`)),
      evidence: orDefault(r.evidence, "", (v) => asString(v, `${p}.evidence`)),
    };
  });
}

export function validateReviewV1(value: unknown): ReviewV1 {
  const c = asObject(value, "$");
  const summary = asString(c.summary, "summary");
  const issues = asArray(c.issues, "issues").map((raw, i) => {
    const p = `issues[${i}]`;
    const item = asObject(raw, p);
    return {
      severity: asEnum(item.severity, SEVERITIES, `${p}.severity`),
      title: asString(item.title, `${p}.title`),
      explanation: asString(item.explanation, `${p}.explanation`),
      recommendation: orDefault(item.recommendation, "", (v) =>
        asString(v, `${p}.recommendation`),
      ),
    };
  });
  return {
    summary,
    issues,
    rewrittenProcedure: orDefault(c.rewrittenProcedure, "", (v) =>
      asString(v, "rewrittenProcedure"),
    ),
    confidence: orDefault(c.confidence, 0, (v) => asConfidence(v, "confidence")),
    indexRecommendations: asIndexRecommendations(c.indexRecommendations),
    rewriteNotes: asRewriteNotes(c.rewriteNotes),
  };
}

export function validateReviewV2(value: unknown): ReviewV2 {
  const c = asObject(value, "$");
  const summary = asString(c.summary, "summary");
  const overallRisk = asEnum(c.overallRisk, RISKS, "overallRisk");
  const confidence = orDefault(c.confidence, 0, (v) => asConfidence(v, "confidence"));

  // A malformed row is dropped (and counted) instead of failing the review;
  // a table that is present but not an array still fails.
  let dropped = 0;
  const rows = <T>(value: unknown, path: string, parse: (r: Record<string, unknown>, p: string) => T): T[] =>
    orDefault<unknown[]>(value, [], (v) => asArray(v, path)).flatMap((raw, i) => {
      try {
        return [parse(asObject(raw, `${path}[${i}]`), `${path}[${i}]`)];
      } catch {
        dropped += 1;
        return [];
      }
    });
  const recommendation = (r: Record<string, unknown>, p: string) =>
    orDefault(r.recommendation, "", (v) => asString(v, `${p}.recommendation`));

  const findingsTable = rows(c.findingsTable, "findingsTable", (r, p) => ({
    category: asEnum(r.category, FINDING_CATEGORIES, `${p}.category`),
    finding: asString(r.finding, `${p}.finding`),
    evidence: asString(r.evidence, `${p}.evidence`),
    severity: asEnum(r.severity, SEVERITIES, `${p}.severity`),
    recommendation: recommendation(r, p),
  }));

  const performanceTable = rows(c.performanceTable, "performanceTable", (r, p) => ({
    area: asEnum(r.area, PERFORMANCE_AREAS, `${p}.area`),
    observation: asString(r.observation, `${p}.observation`),
    evidence: asString(r.evidence, `${p}.evidence`),
    impact: asEnum(r.impact, IMPACTS, `${p}.impact`),
    recommendation: recommendation(r, p),
  }));

  const securityTable = rows(c.securityTable, "securityTable", (r, p) => ({
    area: asEnum(r.area, SECURITY_AREAS, `${p}.area`),
    observation: asString(r.observation, `${p}.observation`),
    evidence: asString(r.evidence, `${p}.evidence`),
    risk: asEnum(r.risk, IMPACTS, `${p}.risk`),
    recommendation: recommendation(r, p),
  }));

  const testingTable = rows(c.testingTable, "testingTable", (r, p) => ({
    test: asString(r.test, `${p}.test`),
    purpose: asString(r.purpose, `${p}.purpose`),
    expectedResult: asString(r.expectedResult, `${p}.expectedResult`),
  }));

  const limitations = orDefault<unknown[]>(c.limitations, [], (v) => asArray(v, "limitations")).filter(
    (item): item is string => typeof item === "string",
  );
  if (dropped > 0) {
    limitations.push(`${dropped} row(s) removed because they did not match the review schema.`);
  }

  return {
    summary,
    overallRisk,
    confidence,
    findingsTable,
    performanceTable,
    securityTable,
    testingTable,
    rewrittenProcedure: orDefault(c.rewrittenProcedure, "", (v) =>
      asString(v, "rewrittenProcedure"),
    ),
    limitations,
    indexRecommendations: asIndexRecommendations(c.indexRecommendations),
    rewriteNotes: asRewriteNotes(c.rewriteNotes),
  };
}

export function validateReview(
  version: SchemaVersion,
  value: unknown,
): ReviewV1 | ReviewV2 {
  return version === "v1" ? validateReviewV1(value) : validateReviewV2(value);
}
