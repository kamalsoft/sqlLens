import { NextResponse } from "next/server";
import { pipeline } from "@huggingface/transformers";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getInstalledModels } from "@/lib/installed-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ReviewRequest = {
  modelId?: string;
  sql?: string;
};

type AppConfig = {
  prompt?: {
    analysisSP?: string;
  };
};

const pipelines = new Map<string, Promise<unknown>>();

type LoadedPrompt = {
  path: string;
  content: string;
};

async function readAnalysisPrompt(): Promise<LoadedPrompt> {
  const configPath = path.join(process.cwd(), "data", "appconfig.json");
  const config = JSON.parse(
    await readFile(configPath, "utf8"),
  ) as AppConfig;

  const configuredPath = config.prompt?.analysisSP;

  if (!configuredPath) {
    throw new Error("The analysisSP prompt path is not configured");
  }

  const promptPath = expandHome(configuredPath);
  const content = (await readFile(promptPath, "utf8")).trim();

  if (!content) {
    throw new Error(`The analysis prompt is empty: ${promptPath}`);
  }

  return { path: promptPath, content };
}

function buildPrompt(template: string, sql: string): string {
  const placeholder = "{{STORED_PROCEDURE}}";

  if (!template.includes(placeholder)) {
    throw new Error(
      "analysisSP.md must contain the {{STORED_PROCEDURE}} placeholder",
    );
  }

  const procedure = [
    "<stored_procedure>",
    sql,
    "</stored_procedure>",
  ].join("\n");

  const prompt = template.replaceAll(placeholder, procedure);

  if (prompt.length > 30_000) {
    throw new Error(
      `Analysis prompt is too large: ${prompt.length} characters`,
    );
  }

  return prompt;
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

async function getModelPipeline(directory: string) {
  let loaded = pipelines.get(directory);

  if (!loaded) {
    loaded = pipeline("text-generation", directory, {
      dtype: "q4",
      device: "cpu",
    });

    pipelines.set(directory, loaded);
  }

  return loaded;
}

type AnalysisResult = {
  summary: string;
  issues: Array<{
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    explanation: string;
    recommendation: string;
  }>;
  rewrittenProcedure: string;
  confidence: number;
};

function extractJson(text: string): AnalysisResult {
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
      return normalizeAnalysis(JSON.parse(candidate));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(
    `${lastError}; response ended with: ${text.slice(-300)}`,
  );
}

type TextGenerator = {
  tokenizer?: {
    apply_chat_template?: (
      messages: Array<{ role: string; content: string }>,
      options: {
        tokenize: boolean;
        add_generation_prompt: boolean;
      },
    ) => string;
  };
  (
    prompt: string,
    options: {
      max_new_tokens: number;
      temperature: number;
      do_sample: boolean;
      return_full_text: boolean;
    },
  ): Promise<Array<{ generated_text?: string }>>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewRequest;
    const sql = body.sql?.trim();

    if (!body.modelId || !sql) {
      return NextResponse.json(
        { error: "modelId and sql are required" },
        { status: 400 },
      );
    }

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
          error:
            `Model "${model.name}" is not compatible with local Transformers.js.`,
        },
        { status: 422 },
      );
    }

    const loadedPrompt = await readAnalysisPrompt();
    const prompt = buildPrompt(loadedPrompt.content, sql);

    const generator = (await getModelPipeline(
      model.directory,
    )) as TextGenerator;

    const messages = [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: "Return the JSON analysis now.",
      },
    ];

    const promptText =
      generator.tokenizer?.apply_chat_template?.(messages, {
        tokenize: false,
        add_generation_prompt: true,
      }) ??
      `${messages[0].content}\n\n${messages[1].content}`;

    const output = await generator(promptText, {
      max_new_tokens: 700,
      temperature: 0,
      do_sample: false,
      return_full_text: false,
    });

    const rawResult = output[0]?.generated_text?.trim();

    if (!rawResult) {
      return NextResponse.json(
        {
          error: "The selected model returned no result",
          model: model.id,
        },
        { status: 502 },
      );
    }

    try {
      const result = extractJson(rawResult);

      return NextResponse.json({
        model: model.id,
        promptPath: loadedPrompt.path,
        result,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Unable to parse model response",
          details: {
            message:
              error instanceof Error ? error.message : String(error),
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
    console.error("Stored procedure review failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stored procedure analysis failed",
      },
      { status: 500 },
    );
  }
}

function normalizeAnalysis(value: unknown): AnalysisResult {
  if (!value || typeof value !== "object") {
    throw new Error("Model returned a non-object analysis");
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.summary !== "string") {
    throw new Error("Model analysis is missing a string summary");
  }

  if (!Array.isArray(candidate.issues)) {
    throw new Error("Model analysis is missing an issues array");
  }

  const issues = candidate.issues.map((issue, index) => {
    if (!issue || typeof issue !== "object") {
      throw new Error(`Model issue ${index + 1} is invalid`);
    }

    const item = issue as Record<string, unknown>;
    const severity = String(item.severity ?? "").toLowerCase();

    if (!["critical", "high", "medium", "low"].includes(severity)) {
      throw new Error(
        `Model issue ${index + 1} has invalid severity: ${item.severity}`,
      );
    }

    return {
      severity: severity as AnalysisResult["issues"][number]["severity"],
      title: String(item.title ?? ""),
      explanation: String(item.explanation ?? ""),
      recommendation: String(item.recommendation ?? ""),
    };
  });

  const rewrittenProcedure = candidate.rewrittenProcedure;

  if (typeof rewrittenProcedure !== "string") {
    throw new Error("Model analysis is missing rewrittenProcedure");
  }

  const confidence = Number(candidate.confidence);

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Model confidence must be a number between 0 and 1");
  }

  return {
    summary: candidate.summary,
    issues,
    rewrittenProcedure,
    confidence,
  };
}
