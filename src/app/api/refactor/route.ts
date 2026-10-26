import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { insertAudit } from "@/db/audit-repo";
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

    if (!isString(body.modelId) || !body.modelId) return badRequest("modelId is required", "modelId");

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

    const resolved = await resolveModel(body.modelId);
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

    const run = await runModel(
      model,
      prompt,
      "Return the JSON object now, then the refactored SQL in the <rewritten_procedure> block.",
      {
        maxNewTokens: config.maxNewTokens,
        temperature: config.temperature,
        timeoutMs: config.inferenceTimeoutMs,
        signal: request.signal,
      },
    );
    if (!run.ok) return run.response;

    const block = splitRewriteBlock(run.text);
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
      request: { sql, instructions, modelId: model.id },
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
