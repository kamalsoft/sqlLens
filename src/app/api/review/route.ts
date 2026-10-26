import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAudit, insertAudit } from "@/db/audit-repo";
import { readAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";
import { rateLimit } from "@/lib/request-guard";
import { logError } from "@/lib/redact";
import { readJson, badRequest, isString } from "@/lib/validation/body";
import { NOT_SQL_ERROR, looksLikeSql, validateSqlInput } from "@/lib/validation/sql-input";
import {
  dropTruncatedRewrite,
  extractJson,
  hasUnclosedObject,
  looksRepetitive,
  splitRewriteBlock,
} from "@/lib/extract-json";
import { dropUnsupportedEvidence } from "@/lib/review-evidence";
import { verifyIndexRecommendations } from "@/lib/index-recommendations";
import { missingDeclarations, newWriteTargets } from "@/lib/rewrite-check";
import { resolveModel, runModel } from "@/lib/model-run";
import { buildPrompt, expandHome, loadPrompt } from "@/lib/review-prompt";
import {
  buildTelemetryPrompt,
  normalizeTelemetry,
  statsFromAuditResponse,
  type NormalizedTelemetry,
} from "@/lib/review-telemetry";
import {
  DEFAULT_SCHEMA_VERSION,
  isSchemaVersion,
  validateReview,
  validateReviewV1,
  type ReviewV1,
  type ReviewV2,
  type RewriteStatus,
  type SchemaVersion,
} from "@/lib/review-schema";

const MAX_RESPONSE_TEXT = 50_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`review:${auth.session.sessionId}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Too many review requests. Try again in a minute." },
      { status: 429 },
    );
  }

  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    if (body.schemaVersion !== undefined && !isSchemaVersion(body.schemaVersion)) {
      return badRequest('schemaVersion must be "v1" or "v2"', "schemaVersion");
    }
    const requestedVersion = isSchemaVersion(body.schemaVersion) ? body.schemaVersion : null;

    if (!isString(body.modelId) || !body.modelId) {
      return badRequest("modelId is required", "modelId");
    }

    const config = await readAppConfig();
    const checked = validateSqlInput(body.sql, config.maxSqlLength);
    if (!checked.ok) return badRequest(checked.error, "sql");
    if (!looksLikeSql(checked.sql)) return badRequest(NOT_SQL_ERROR, "sql");
    const sql = checked.sql.trim();

    const resolved = await resolveModel(body.modelId);
    if (!resolved.ok) return resolved.response;
    const model = resolved.model;
    const lowConfidence = model.small === true;
    // Small models default to v1 (D-035); an explicit schemaVersion is honoured.
    const schemaVersion: SchemaVersion = requestedVersion ?? (lowConfidence ? "v1" : DEFAULT_SCHEMA_VERSION);

    // Optional telemetry from one of this session's own EXECUTE audits (owner-only lookup).
    let telemetry: NormalizedTelemetry | undefined;
    let executionAuditId: string | undefined;
    if (body.executionAuditId !== undefined) {
      if (!isString(body.executionAuditId) || !body.executionAuditId) {
        return badRequest("executionAuditId must be a non-empty string", "executionAuditId");
      }
      if (schemaVersion !== "v2") {
        return badRequest("Telemetry-aware review requires schemaVersion v2", "schemaVersion");
      }
      const source = getAudit(body.executionAuditId, auth.session.sessionId);
      if (!source) {
        return NextResponse.json({ error: "Execution audit not found" }, { status: 404 });
      }
      const stats =
        source.type === "EXECUTE" || source.type === "EXECUTE_COMPARE"
          ? statsFromAuditResponse(source.response)
          : null;
      if (!stats) {
        return badRequest("The audit record has no execution telemetry", "executionAuditId");
      }
      telemetry = normalizeTelemetry(stats);
      executionAuditId = source.id;
    }

    let promptPath: string;
    let prompt: string;
    if (telemetry) {
      const configured = config.prompt?.reviewWithTelemetry;
      promptPath = configured
        ? expandHome(configured)
        : path.join(process.cwd(), "data", "prompts", "review-with-telemetry.md");
      prompt = buildTelemetryPrompt((await readFile(promptPath, "utf8")).trim(), sql, telemetry);
    } else {
      const loadedPrompt = await loadPrompt(schemaVersion, config.prompt);
      promptPath = loadedPrompt.path;
      prompt = buildPrompt(loadedPrompt.content, sql);
    }

    const run = await runModel(model, prompt, "Return the JSON analysis now.", {
      maxNewTokens: config.maxNewTokens,
      temperature: config.temperature,
      timeoutMs: config.inferenceTimeoutMs,
      signal: request.signal,
    });
    if (!run.ok) return run.response;
    const rawResult = run.text;
    const finished = !run.hitTokenLimit;
    // The prompts ask for the rewrite as plain SQL after the JSON, so it needs
    // no JSON escaping; only the JSON part is parsed below.
    const block = splitRewriteBlock(rawResult);
    const jsonText = block.json;

    // Tries the requested schema, then (v2 without telemetry) the v1 shape:
    // small models often answer a v2 prompt in the simpler v1 form.
    const parse = (text: string): { result: ReviewV1 | ReviewV2; version: SchemaVersion } => {
      try {
        return { result: extractJson(text, (value) => validateReview(schemaVersion, value), { finished }), version: schemaVersion };
      } catch (error) {
        if (schemaVersion === "v2" && !telemetry) {
          try {
            return { result: extractJson(text, validateReviewV1, { finished }), version: "v1" };
          } catch {
            // report the v2 error
          }
        }
        throw error;
      }
    };

    let parsedReview: { result: ReviewV1 | ReviewV2; version: SchemaVersion } | undefined;
    let rewriteTruncated = false;
    let parseError: unknown;
    try {
      parsedReview = parse(jsonText);
    } catch (error) {
      parseError = error;
      // Cut off inside the final rewrite: keep the review, discard the partial SQL.
      const salvaged = run.hitTokenLimit ? dropTruncatedRewrite(jsonText) : null;
      if (salvaged) {
        try {
          parsedReview = parse(salvaged);
          rewriteTruncated = true;
        } catch {
          // report the original error
        }
      }
    }
    if (parsedReview === undefined) {
      const error = parseError;
      const unclosed = hasUnclosedObject(jsonText);
      const truncated = unclosed && run.hitTokenLimit;
      const repeating = truncated && looksRepetitive(rawResult);
      return NextResponse.json(
        {
          error: repeating
            ? `The model got stuck repeating itself and used all ${config.maxNewTokens} new tokens before finishing the JSON. Retry, or use a larger model; raising maxNewTokens will not help.`
            : truncated
              ? `The model output was cut off before the JSON was complete (limit ${config.maxNewTokens} new tokens). Raise maxNewTokens in Settings or use schema v1.`
              : unclosed
                ? "The model stopped before finishing the JSON. Retry, or use a larger model."
                : "Unable to parse model response",
          details: {
            message: error instanceof Error ? error.message : String(error),
            model: model.id,
            responseCharacters: rawResult.length,
            responsePreview: rawResult.slice(0, 500),
            responseTail: rawResult.slice(-500),
            // Full untrusted text so the page can show it as plain text.
            responseText: rawResult.slice(0, MAX_RESPONSE_TEXT),
          },
        },
        { status: 502 },
      );
    }

    let result = parsedReview.result;
    if (block.rewrite !== null) {
      // Ended inside the rewrite block because of the token limit: drop it.
      if (!block.closed && run.hitTokenLimit) rewriteTruncated = true;
      else result = { ...result, rewrittenProcedure: block.rewrite };
    }
    const resultVersion = parsedReview.version;
    if (resultVersion === "v2") result = dropUnsupportedEvidence(result as ReviewV2, sql);
    const indexes = verifyIndexRecommendations(result.indexRecommendations, sql);
    result = { ...result, indexRecommendations: indexes.kept };
    if (indexes.removed > 0 && resultVersion === "v2") {
      const v2 = result as ReviewV2;
      result = {
        ...v2,
        limitations: [
          ...v2.limitations,
          `${indexes.removed} index recommendation(s) removed because their table or columns were not found in the submitted procedure.`,
        ],
      };
    }

    // Models sometimes wrap the rewrite in a Markdown code fence.
    result = { ...result, rewrittenProcedure: result.rewrittenProcedure.replace(/^\s*```[a-z]*\s*$/gim, "").trim() };

    // The rewrite is model output: keep it only when it reads as SQL.
    let rewriteStatus: RewriteStatus = rewriteTruncated
      ? "truncated"
      : result.rewrittenProcedure.trim()
        ? "provided"
        : "none";
    let rewriteDetail: string | undefined;
    if (rewriteStatus === "provided" && !looksLikeSql(result.rewrittenProcedure)) rewriteStatus = "invalid";
    if (rewriteStatus === "provided") {
      // A restructure must not change what data the procedure modifies.
      const added = newWriteTargets(sql, result.rewrittenProcedure);
      const missing = missingDeclarations(sql, result.rewrittenProcedure);
      if (added.length > 0) {
        rewriteStatus = "unsafe";
        rewriteDetail = `Writes to ${added.join(", ")}`;
      } else if (missing.length > 0) {
        rewriteStatus = "invalid";
        rewriteDetail = `Uses ${missing.join(", ")} without declaring or creating it`;
      }
    }
    result =
      rewriteStatus === "provided"
        ? { ...result, rewriteStatus }
        : {
            ...result,
            rewrittenProcedure: "",
            rewriteNotes: [],
            rewriteStatus,
            ...(rewriteDetail ? { rewriteDetail } : {}),
          };
    const schemaFallback = resultVersion !== schemaVersion;

    const saved = insertAudit({
      sessionId: auth.session.sessionId,
      type: "REVIEW",
      request: { sql, modelId: model.id, schemaVersion, executionAuditId: executionAuditId ?? null },
      response: result,
      schemaVersion: resultVersion,
      modelId: model.id,
      simulated: telemetry?.simulated ?? false,
    });

    return NextResponse.json({
      id: saved.id,
      recordNumber: saved.recordNumber,
      model: model.id,
      schemaVersion: resultVersion,
      lowConfidence: lowConfidence || schemaFallback,
      ...(schemaFallback ? { schemaFallback: true } : {}),
      promptPath,
      ...(executionAuditId ? { executionAuditId } : {}),
      result,
    });
  } catch (error) {
    logError("Stored procedure review failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
