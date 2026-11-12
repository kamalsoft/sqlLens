import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAudit, insertAudit } from "@/db/audit-repo";
import { chooseRefactorModel, getInstalledModels } from "@/lib/installed-models";
import { readAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";
import { extractJson, hasUnclosedObject, splitRewriteBlock } from "@/lib/extract-json";
import { resolveModel, runModel } from "@/lib/model-run";
import {
  MAX_INSTRUCTIONS_LENGTH,
  RefactorTooLargeError,
  buildRefactorPrompt,
  finishRefactor,
  validateRefactor,
} from "@/lib/refactor";
import { logError } from "@/lib/redact";
import { rateLimit } from "@/lib/request-guard";
import { expandHome } from "@/lib/review-prompt";
import { badRequest, isString, readJson } from "@/lib/validation/body";
import { NOT_SQL_ERROR, looksLikeSql, validateSqlInput } from "@/lib/validation/sql-input";

const MAX_RESPONSE_TEXT = 50_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`refactor:${auth.session.sessionId}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many refactor requests. Try again in a minute." }, { status: 429 });
  }

  try {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    if (body.modelId !== undefined && (!isString(body.modelId) || !body.modelId)) {
      return badRequest("modelId must be a non-empty string", "modelId");
    }

    // AD-2: the execution this refactor came from; it must be one of this session's own run records.
    const source = body.sourceAuditId;
    if (source !== undefined && source !== null && (typeof source !== "string" || !source)) {
      return badRequest("sourceAuditId must be an audit record id", "sourceAuditId");
    }
    let sourceAuditId: string | null = null;
    if (typeof source === "string") {
      const run = getAudit(source, auth.session.sessionId);
      if (!run || (run.type !== "EXECUTE" && run.type !== "EXECUTE_COMPARE")) {
        return badRequest("sourceAuditId is not one of your execution records", "sourceAuditId");
      }
      sourceAuditId = run.id;
    }

    const config = await readAppConfig();
    const checked = validateSqlInput(body.sql, config.maxSqlLength);
    if (!checked.ok) return badRequest(checked.error, "sql");
    if (!looksLikeSql(checked.sql)) return badRequest(NOT_SQL_ERROR, "sql");
    const sql = checked.sql.trim();

    if (body.instructions !== undefined && !isString(body.instructions)) {
      return badRequest("instructions must be a string", "instructions");
    }
    const instructions = (body.instructions ?? "").trim();
    if (instructions.includes("\0")) return badRequest("instructions contain invalid characters", "instructions");
    if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      return badRequest(`instructions exceed ${MAX_INSTRUCTIONS_LENGTH} characters`, "instructions");
    }

    // Without a modelId (the Execute screen), use the model chosen in Settings, or the best one installed.
    let modelId = body.modelId as string | undefined;
    if (!modelId) {
      const best = chooseRefactorModel(await getInstalledModels(), config.refactorModel);
      if (!best) {
        return NextResponse.json({ error: "No compatible model is installed. Install one in Manage Models." }, { status: 404 });
      }
      modelId = best.id;
    }
    const resolved = await resolveModel(modelId);
    if (!resolved.ok) return resolved.response;
    const model = resolved.model;

    const configured = config.prompt?.refactor;
    const promptPath = configured ? expandHome(configured) : path.join(process.cwd(), "data", "prompts", "refactor.md");
    let prompt: string;
    try {
      prompt = buildRefactorPrompt((await readFile(promptPath, "utf8")).trim(), sql, instructions);
    } catch (error) {
      if (error instanceof RefactorTooLargeError) {
        return badRequest("The procedure and instructions are too large to refactor. Shorten them.", "sql");
      }
      throw error;
    }

    const message = "Return the JSON object now, then the refactored SQL in the <rewritten_procedure> block.";
    const run = await runModel(
      model,
      prompt,
      message,
      {
        maxNewTokens: config.maxNewTokens,
        temperature: config.temperature,
        timeoutMs: config.inferenceTimeoutMs,
        signal: request.signal,
      },
    );
    if (!run.ok) return run.response;

    const block = splitRewriteBlock(run.text, { sqlFence: true });
    let answer;
    try {
      answer = extractJson(block.json, validateRefactor, { finished: !run.hitTokenLimit });
    } catch (error) {
      const cutOff = hasUnclosedObject(block.json) && run.hitTokenLimit;
      return NextResponse.json(
        {
          error: cutOff
            ? `The model output was cut off before the JSON was complete (limit ${config.maxNewTokens} new tokens). Raise maxNewTokens in Settings.`
            : "Unable to parse model response",
          details: {
            message: error instanceof Error ? error.message : String(error),
            model: model.id,
            responseCharacters: run.text.length,
            responsePreview: run.text.slice(0, 500),
            responseText: run.text.slice(0, MAX_RESPONSE_TEXT),
          },
        },
        { status: 502 },
      );
    }

    const result = finishRefactor(answer, sql, block, run.hitTokenLimit);
    const saved = insertAudit({
      sessionId: auth.session.sessionId,
      type: "REFACTOR",
      request: {
        sql, instructions, modelId: model.id, sourceAuditId,
        // AD-1: what the model was given, for the audit record page.
        prompt: { template: path.basename(promptPath), text: prompt, message },
      },
      response: result,
      schemaVersion: "refactor-v1",
      modelId: model.id,
      simulated: false,
    });

    return NextResponse.json({
      id: saved.id,
      recordNumber: saved.recordNumber,
      model: model.id,
      promptPath,
      lowConfidence: model.small === true,
      result,
    });
  } catch (error) {
    logError("Stored procedure refactor failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
