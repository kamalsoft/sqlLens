import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAudit, insertAudit } from "@/db/audit-repo";
import { compareExecutions, type MetricComparison } from "@/lib/audit-analyzer";
import { requireSession } from "@/lib/auth";
import { readAppConfig } from "@/lib/app-config";
import {
  COMPARE_SCHEMA_VERSION,
  CompareTooLargeError,
  buildComparePrompt,
  validateCompare,
} from "@/lib/compare";
import { extractJson } from "@/lib/extract-json";
import { resolveModel, runModel } from "@/lib/model-run";
import { logError } from "@/lib/redact";
import { expandHome } from "@/lib/review-prompt";
import { rateLimit } from "@/lib/request-guard";
import type { ExecutionResult } from "@/lib/sp-executor";
import { badRequest, isString, readJson } from "@/lib/validation/body";
import { NOT_SQL_ERROR, looksLikeSql, validateSqlInput } from "@/lib/validation/sql-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;


function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extracts one side's ExecutionResult from a persisted EXECUTE / EXECUTE_COMPARE response. */
function executionOf(response: unknown, side: "original" | "optimized", type: string): ExecutionResult | null {
  if (!isObject(response)) return null;
  const holder = type === "EXECUTE_COMPARE" ? response[side] : type === "EXECUTE" ? response : null;
  const execution = isObject(holder) ? holder.execution : null;
  if (!isObject(execution) || !isObject(execution.stats)) return null;
  const stats = execution.stats;
  if (!Array.isArray(stats.io) || typeof stats.simulated !== "boolean") return null;
  return execution as unknown as ExecutionResult;
}

/** Procedure text recorded on the audit (only batch targets store SQL; named procedures do not). */
function storedSql(request: unknown, side: "original" | "optimized", type: string): string | null {
  // A single EXECUTE audit records its procedure under "original".
  const key = type === "EXECUTE" ? "original" : side;
  if (!isObject(request) || !isObject(request[key])) return null;
  const target = request[key] as Record<string, unknown>;
  return target.kind === "batch" && isString(target.sql) ? target.sql : null;
}

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`compare:${auth.session.sessionId}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Too many compare requests. Try again in a minute." },
      { status: 429 },
    );
  }

  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const config = await readAppConfig();

    if (!isString(body.modelId) || !body.modelId) {
      return badRequest("modelId is required", "modelId");
    }

    const hasIds = body.originalAuditId !== undefined || body.optimizedAuditId !== undefined;
    let originalSql: string | undefined;
    let optimizedSql: string | undefined;
    let metrics: MetricComparison | null = null;
    let originalAuditId: string | null = null;
    let optimizedAuditId: string | null = null;
    let simulated = false;

    if (body.original !== undefined) {
      const original = validateSqlInput(body.original, config.maxSqlLength);
      if (!original.ok) return badRequest(original.error, "original");
      if (!looksLikeSql(original.sql)) return badRequest(NOT_SQL_ERROR, "original");
      originalSql = original.sql.trim();
    }
    if (body.optimized !== undefined) {
      const optimized = validateSqlInput(body.optimized, config.maxSqlLength);
      if (!optimized.ok) return badRequest(optimized.error, "optimized");
      if (!looksLikeSql(optimized.sql)) return badRequest(NOT_SQL_ERROR, "optimized");
      optimizedSql = optimized.sql.trim();
    }

    if (hasIds) {
      if (!isString(body.originalAuditId) || !body.originalAuditId) {
        return badRequest("originalAuditId is required with optimizedAuditId", "originalAuditId");
      }
      if (!isString(body.optimizedAuditId) || !body.optimizedAuditId) {
        return badRequest("optimizedAuditId is required with originalAuditId", "optimizedAuditId");
      }
      // Owner-only lookups: another session's record is indistinguishable from a missing one.
      const a = getAudit(body.originalAuditId, auth.session.sessionId);
      const b = getAudit(body.optimizedAuditId, auth.session.sessionId);
      if (!a || !b) {
        return NextResponse.json({ error: "Audit record not found" }, { status: 404 });
      }
      const ra = executionOf(a.response, "original", a.type);
      const rb = executionOf(b.response, "optimized", b.type);
      if (!ra || !rb) {
        return badRequest("Both audit records must be EXECUTE or EXECUTE_COMPARE results with telemetry", "originalAuditId");
      }
      try {
        metrics = compareExecutions(ra, rb).metrics;
      } catch {
        return badRequest(
          "Cannot compare a simulated result with a real execution result (D-004)",
          "originalAuditId",
        );
      }
      simulated = ra.stats.simulated;
      originalAuditId = a.id;
      optimizedAuditId = b.id;
      originalSql ??= storedSql(a.request, "original", a.type) ?? undefined;
      optimizedSql ??= storedSql(b.request, "optimized", b.type) ?? undefined;
    }

    if (!originalSql) {
      return badRequest("original procedure text is required (not stored on the audit record)", "original");
    }
    if (!optimizedSql) {
      return badRequest("optimized procedure text is required (not stored on the audit record)", "optimized");
    }

    const resolved = await resolveModel(body.modelId);
    if (!resolved.ok) return resolved.response;
    const model = resolved.model;

    const promptPath = config.prompt?.compare
      ? expandHome(config.prompt.compare)
      : path.join(process.cwd(), "data", "prompts", "compare.md");
    let prompt: string;
    try {
      prompt = buildComparePrompt(
        (await readFile(promptPath, "utf8")).trim(),
        originalSql,
        optimizedSql,
        metrics,
      );
    } catch (error) {
      if (error instanceof CompareTooLargeError) {
        return badRequest("The procedures are too large to compare. Shorten the SQL.", "original");
      }
      throw error;
    }

    const run = await runModel(
      model,
      prompt,
      "Return the JSON comparison now.",
      {
        maxNewTokens: config.maxNewTokens,
        temperature: config.temperature,
        timeoutMs: config.inferenceTimeoutMs,
        signal: request.signal,
      },
      "original",
    );
    if (!run.ok) return run.response;

    let result;
    try {
      result = extractJson(run.text, validateCompare);
    } catch (error) {
      return NextResponse.json(
        {
          error: "Unable to parse model response",
          details: {
            message: error instanceof Error ? error.message : String(error),
            model: model.id,
            responseCharacters: run.text.length,
            responsePreview: run.text.slice(0, 500),
          },
        },
        { status: 502 },
      );
    }

    const saved = insertAudit({
      sessionId: auth.session.sessionId,
      type: "COMPARE",
      request: {
        original: originalSql,
        optimized: optimizedSql,
        originalAuditId,
        optimizedAuditId,
        modelId: model.id,
      },
      response: { result, metrics, originalAuditId, optimizedAuditId },
      schemaVersion: COMPARE_SCHEMA_VERSION,
      modelId: model.id,
      simulated,
    });

    return NextResponse.json({
      id: saved.id,
      recordNumber: saved.recordNumber,
      model: model.id,
      schemaVersion: COMPARE_SCHEMA_VERSION,
      promptPath,
      sharedToken: null,
      metrics,
      result,
    });
  } catch (error) {
    logError("[compare/route]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
