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
import { chooseRefactorModel, getInstalledModels } from "@/lib/installed-models";
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

    if (body.modelId !== undefined && (!isString(body.modelId) || !body.modelId)) {
      return badRequest("modelId must be an installed model id", "modelId");
    }

    const config = await readAppConfig();
    const checked = validateSqlInput(body.sql, config.maxSqlLength);
    if (!checked.ok) return badRequest(checked.error, "sql");
    if (!looksLikeSql(checked.sql)) return badRequest(NOT_SQL_ERROR, "sql");
    const sql = checked.sql.trim();

    // RV-1: without a modelId (the Review screen), use the Review model from Settings, or the best one installed.
    let modelId = body.modelId as string | undefined;
    if (!modelId) {
      const best = chooseRefactorModel(await getInstalledModels(), config.reviewModel);
      if (!best) {
        return NextResponse.json({ error: "No compatible model is installed. Install one in Manage Models." }, { status: 404 });
      }
      modelId = best.id;
    }
    const resolved = await resolveModel(modelId);
    if (!resolved.ok) return resolved.response;
    const model = resolved.model;
    const lowConfidence = model.small === true;
    // Small models default to v1 (D-035); an explicit schemaVersion, then Settings, is honoured.
    const configured = config.reviewSchema === "v1" || config.reviewSchema === "v2" ? config.reviewSchema : null;
    let schemaVersion: SchemaVersion = requestedVersion ?? configured ?? (lowConfidence ? "v1" : DEFAULT_SCHEMA_VERSION);

    // Optional telemetry from one of this session's own EXECUTE audits (owner-only lookup).
    let telemetry: NormalizedTelemetry | undefined;
    let executionAuditId: string | undefined;
    if (body.executionAuditId !== undefined) {
      if (!isString(body.executionAuditId) || !body.executionAuditId) {
        return badRequest("executionAuditId must be a non-empty string", "executionAuditId");
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
      // RV-3: the telemetry prompt asks for v2 tables; a small model's v1 answer is still accepted below.
      schemaVersion = "v2";
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

    const message = "Return the JSON analysis now.";
    const run = await runModel(model, prompt, message, {
      maxNewTokens: config.maxNewTokens,
      temperature: config.temperature,
      timeoutMs: config.inferenceTimeoutMs,
      signal: request.signal,
    });
    if (!run.ok) return run.response;
    const rawResult = run.text;
    const finished = !run.hitTokenLimit;
    // RV-2: Review returns findings only (Refactor writes the rewrite); a rewrite block a
    // model still adds after the JSON is split off and discarded.
    const block = splitRewriteBlock(rawResult);
    const jsonText = block.json;

    // Tries the requested schema, then (for v2) the v1 shape: small models often
    // answer a v2 prompt in the simpler v1 form.
    const parse = (text: string): { result: ReviewV1 | ReviewV2; version: SchemaVersion } => {
      try {
        return { result: extractJson(text, (value) => validateReview(schemaVersion, value), { finished }), version: schemaVersion };
      } catch (error) {
        if (schemaVersion === "v2") {
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

    // Findings only: no rewrite is kept, so the result view shows no restructure section.
    let result: ReviewV1 | ReviewV2 = { ...parsedReview.result, rewrittenProcedure: "", rewriteNotes: [] };
    delete result.rewriteStatus;
    delete result.rewriteDetail;
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

    const schemaFallback = resultVersion !== schemaVersion;

    const saved = insertAudit({
      sessionId: auth.session.sessionId,
      type: "REVIEW",
      request: {
        sql, modelId: model.id, schemaVersion, executionAuditId: executionAuditId ?? null,
        // AD-1: what the model was given, for the audit record page.
        prompt: { template: path.basename(promptPath), text: prompt, message },
      },
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
