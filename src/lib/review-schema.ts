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

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  const normalized = String(value ?? "").toLowerCase();
  if (!(allowed as readonly string[]).includes(normalized)) {
    fail(path, `must be one of ${allowed.join("|")} (got ${JSON.stringify(value)})`);
  }
  return normalized as T;
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
      recommendation: asString(item.recommendation, `${p}.recommendation`),
    };
  });
  return {
    summary,
    issues,
    rewrittenProcedure: asString(c.rewrittenProcedure, "rewrittenProcedure"),
    confidence: asConfidence(c.confidence, "confidence"),
  };
}

export function validateReviewV2(value: unknown): ReviewV2 {
  const c = asObject(value, "$");
  const summary = asString(c.summary, "summary");
  const overallRisk = asEnum(c.overallRisk, RISKS, "overallRisk");
  const confidence = asConfidence(c.confidence, "confidence");

  const findingsTable = asArray(c.findingsTable, "findingsTable").map((raw, i) => {
    const p = `findingsTable[${i}]`;
    const r = asObject(raw, p);
    return {
      category: asEnum(r.category, FINDING_CATEGORIES, `${p}.category`),
      finding: asString(r.finding, `${p}.finding`),
      evidence: asString(r.evidence, `${p}.evidence`),
      severity: asEnum(r.severity, SEVERITIES, `${p}.severity`),
      recommendation: asString(r.recommendation, `${p}.recommendation`),
    };
  });

  const performanceTable = asArray(c.performanceTable, "performanceTable").map((raw, i) => {
    const p = `performanceTable[${i}]`;
    const r = asObject(raw, p);
    return {
      area: asEnum(r.area, PERFORMANCE_AREAS, `${p}.area`),
      observation: asString(r.observation, `${p}.observation`),
      evidence: asString(r.evidence, `${p}.evidence`),
      impact: asEnum(r.impact, IMPACTS, `${p}.impact`),
      recommendation: asString(r.recommendation, `${p}.recommendation`),
    };
  });

  const securityTable = asArray(c.securityTable, "securityTable").map((raw, i) => {
    const p = `securityTable[${i}]`;
    const r = asObject(raw, p);
    return {
      area: asEnum(r.area, SECURITY_AREAS, `${p}.area`),
      observation: asString(r.observation, `${p}.observation`),
      evidence: asString(r.evidence, `${p}.evidence`),
      risk: asEnum(r.risk, IMPACTS, `${p}.risk`),
      recommendation: asString(r.recommendation, `${p}.recommendation`),
    };
  });

  const testingTable = asArray(c.testingTable, "testingTable").map((raw, i) => {
    const p = `testingTable[${i}]`;
    const r = asObject(raw, p);
    return {
      test: asString(r.test, `${p}.test`),
      purpose: asString(r.purpose, `${p}.purpose`),
      expectedResult: asString(r.expectedResult, `${p}.expectedResult`),
    };
  });

  const limitations = asArray(c.limitations, "limitations").map((raw, i) =>
    asString(raw, `limitations[${i}]`),
  );

  return {
    summary,
    overallRisk,
    confidence,
    findingsTable,
    performanceTable,
    securityTable,
    testingTable,
    rewrittenProcedure: asString(c.rewrittenProcedure, "rewrittenProcedure"),
    limitations,
  };
}

export function validateReview(
  version: SchemaVersion,
  value: unknown,
): ReviewV1 | ReviewV2 {
  return version === "v1" ? validateReviewV1(value) : validateReviewV2(value);
}
