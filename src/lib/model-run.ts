import { NextResponse } from "next/server";
import { getInstalledModels } from "@/lib/installed-models";
import {
  InferenceBusyError,
  InferenceTimeoutError,
  PromptTooLargeError,
  generateTextDetailed,
} from "@/lib/inference";
import { badRequest } from "@/lib/validation/body";

export type RunnableModel = { id: string; name: string; directory: string; small?: boolean };

export async function resolveModel(
  modelId: string,
): Promise<{ ok: true; model: RunnableModel } | { ok: false; response: NextResponse }> {
  const models = await getInstalledModels();
  const model = models.find((item) => item.id === modelId);

  if (!model) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The selected model is not installed" },
        { status: 404 },
      ),
    };
  }
  if (!model.compatible) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Model "${model.name}" is not compatible with local Transformers.js.` },
        { status: 422 },
      ),
    };
  }
  return { ok: true, model };
}

/** Runs one local generation and maps inference failures to HTTP responses. Other errors are rethrown. */
export async function runModel(
  model: RunnableModel,
  prompt: string,
  userMessage: string,
  options: { maxNewTokens: number; temperature: number; timeoutMs: number },
  sqlField = "sql",
): Promise<{ ok: true; text: string; hitTokenLimit: boolean } | { ok: false; response: NextResponse }> {
  try {
    const { text, hitTokenLimit } = await generateTextDetailed(
      model.directory,
      [
        { role: "system", content: prompt },
        { role: "user", content: userMessage },
      ],
      options,
    );
    if (!text) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "The selected model returned no result", model: model.id },
          { status: 502 },
        ),
      };
    }
    return { ok: true, text, hitTokenLimit };
  } catch (error) {
    if (error instanceof InferenceTimeoutError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "The model did not finish in time. Try a shorter procedure or raise inferenceTimeoutMs in Settings.",
          },
          { status: 504 },
        ),
      };
    }
    if (error instanceof InferenceBusyError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Another review is still running. Wait for it to finish, then retry." },
          { status: 429 },
        ),
      };
    }
    if (error instanceof PromptTooLargeError) {
      return {
        ok: false,
        response: badRequest(
          "The procedure is too large for the model context window. Shorten the SQL or raise contextWindow in Settings.",
          sqlField,
        ),
      };
    }
    throw error;
  }
}
