import { NextResponse } from "next/server";
import { getInstalledModels } from "@/lib/installed-models";
import { readAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";
import { rateLimit } from "@/lib/request-guard";
import { logError } from "@/lib/redact";
import { readJson, badRequest, isString } from "@/lib/validation/body";
import { validateSqlInput } from "@/lib/validation/sql-input";
import {
  InferenceBusyError,
  InferenceTimeoutError,
  PromptTooLargeError,
  generateText,
} from "@/lib/inference";
import { buildPrompt, loadPrompt } from "@/lib/review-prompt";
import {
  DEFAULT_SCHEMA_VERSION,
  isSchemaVersion,
  validateReview,
  type ReviewV1,
  type ReviewV2,
  type SchemaVersion,
} from "@/lib/review-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_NEW_TOKENS = 700;

function extractJson(
  text: string,
  version: SchemaVersion,
): ReviewV1 | ReviewV2 {
  const candidates: string[] = [];

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;

    let depth = 0;
    let quoted = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const character = text[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        quoted = !quoted;
        continue;
      }

      if (!quoted && character === "{") depth += 1;
      if (!quoted && character === "}") depth -= 1;

      if (!quoted && depth === 0) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  }

  let lastError = "No complete JSON object found";

  for (const candidate of candidates) {
    try {
      return validateReview(version, JSON.parse(candidate));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`${lastError}; response ended with: ${text.slice(-300)}`);
}

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
    const schemaVersion: SchemaVersion = isSchemaVersion(body.schemaVersion)
      ? body.schemaVersion
      : DEFAULT_SCHEMA_VERSION;

    if (!isString(body.modelId) || !body.modelId) {
      return badRequest("modelId is required", "modelId");
    }

    const config = await readAppConfig();
    const checked = validateSqlInput(body.sql, config.maxSqlLength);
    if (!checked.ok) return badRequest(checked.error, "sql");
    const sql = checked.sql.trim();

    const models = await getInstalledModels();
    const model = models.find((item) => item.id === body.modelId);

    if (!model) {
      return NextResponse.json(
        { error: "The selected model is not installed" },
        { status: 404 },
      );
    }

    if (!model.compatible) {
      return NextResponse.json(
        {
          error: `Model "${model.name}" is not compatible with local Transformers.js.`,
        },
        { status: 422 },
      );
    }

    const loadedPrompt = await loadPrompt(schemaVersion, config.prompt);
    const prompt = buildPrompt(loadedPrompt.content, sql);

    let rawResult: string;
    try {
      rawResult = await generateText(
        model.directory,
        [
          { role: "system", content: prompt },
          { role: "user", content: "Return the JSON analysis now." },
        ],
        {
          maxNewTokens: MAX_NEW_TOKENS,
          temperature: config.temperature,
          timeoutMs: config.inferenceTimeoutMs,
        },
      );
    } catch (error) {
      if (error instanceof InferenceTimeoutError) {
        return NextResponse.json(
          {
            error:
              "The model did not finish in time. Try a shorter procedure or raise inferenceTimeoutMs in Settings.",
          },
          { status: 504 },
        );
      }
      if (error instanceof InferenceBusyError) {
        return NextResponse.json(
          {
            error:
              "Another review is still running. Wait for it to finish, then retry.",
          },
          { status: 429 },
        );
      }
      if (error instanceof PromptTooLargeError) {
        return badRequest(
          "The procedure is too large for the model context window. Shorten the SQL or raise contextWindow in Settings.",
          "sql",
        );
      }
      throw error;
    }

    if (!rawResult) {
      return NextResponse.json(
        { error: "The selected model returned no result", model: model.id },
        { status: 502 },
      );
    }

    try {
      const result = extractJson(rawResult, schemaVersion);

      return NextResponse.json({
        id: crypto.randomUUID(),
        model: model.id,
        schemaVersion,
        promptPath: loadedPrompt.path,
        result,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Unable to parse model response",
          details: {
            message: error instanceof Error ? error.message : String(error),
            model: model.id,
            responseCharacters: rawResult.length,
            responsePreview: rawResult.slice(0, 500),
            responseTail: rawResult.slice(-500),
          },
        },
        { status: 502 },
      );
    }
  } catch (error) {
    logError("Stored procedure review failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
