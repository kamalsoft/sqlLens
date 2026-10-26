import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readAppConfig } from "@/lib/app-config";

export type ChatMessage = { role: "system" | "user"; content: string };

export type GenerateOptions = {
  maxNewTokens: number;
  temperature: number;
  timeoutMs: number;
  /** Overrides config.contextWindow (tests). */
  contextWindow?: number;
  /** Aborted when the client goes away: generation stops and frees the slot. */
  signal?: AbortSignal;
};

export type Dtype = "q4" | "q8" | "fp16" | "fp32";

/** `hitTokenLimit`: generation used (nearly) its whole new-token budget. */
export type GenerateResult = { text: string; hitTokenLimit: boolean };

export type TextGenerator = {
  tokenizer?: {
    apply_chat_template?: (
      messages: Array<{ role: string; content: string }>,
      options: { tokenize: boolean; add_generation_prompt: boolean },
    ) => string;
    encode?: (text: string) => ArrayLike<number>;
  };
  (
    prompt: string,
    options: {
      max_new_tokens: number;
      temperature?: number;
      do_sample: boolean;
      return_full_text: boolean;
      stopping_criteria?: unknown;
    },
  ): Promise<Array<{ generated_text?: string }>>;
};

export type PipelineFactory = (
  modelDir: string,
  dtype: Dtype,
) => Promise<TextGenerator>;

export class InferenceTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Inference timed out after ${timeoutMs} ms`);
    this.name = "InferenceTimeoutError";
  }
}

export class InferenceBusyError extends Error {
  constructor() {
    super("Another inference is already running");
    this.name = "InferenceBusyError";
  }
}

export class PromptTooLargeError extends Error {
  constructor(
    public readonly promptTokens: number,
    public readonly limit: number,
  ) {
    super(
      `Prompt is too large: ${promptTokens} tokens against a limit of ${limit} tokens`,
    );
    this.name = "PromptTooLargeError";
  }
}

// Preference order; names match Transformers.js 4.2.0 DATA_TYPES.
const DTYPE_FILES: Array<[string, Dtype]> = [
  ["model_q4.onnx", "q4"],
  ["model_quantized.onnx", "q8"],
  ["model.onnx", "fp32"],
  ["model_fp16.onnx", "fp16"],
];

const MIN_NEW_TOKENS = 64;

const pipelines = new Map<string, Promise<TextGenerator>>();
const status = new Map<
  string,
  { loaded: boolean; loading: boolean; lastError?: string }
>();
let busy = false;
let factoryOverride: PipelineFactory | null = null;

export function setPipelineFactoryForTests(fn: PipelineFactory | null): void {
  factoryOverride = fn;
  pipelines.clear();
  status.clear();
  busy = false;
}

export function isFakeInferenceEnabled(): boolean {
  return (
    process.env.SQLLENS_FAKE_INFERENCE === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

export function getModelStatus(): Record<
  string,
  { loaded: boolean; loading: boolean; lastError?: string }
> {
  return Object.fromEntries(
    [...status.entries()].map(([key, value]) => [key, { ...value }]),
  );
}

function setStatus(
  dir: string,
  patch: Partial<{ loaded: boolean; loading: boolean; lastError?: string }>,
) {
  const current = status.get(dir) ?? { loaded: false, loading: false };
  status.set(dir, { ...current, ...patch });
}

export async function detectDtype(modelDir: string): Promise<Dtype> {
  let files: string[] = [];
  try {
    files = await readdir(path.join(modelDir, "onnx"));
  } catch {
    // handled below
  }
  for (const [file, dtype] of DTYPE_FILES) {
    if (files.includes(file)) return dtype;
  }
  throw new Error("No supported ONNX model file found in the model directory");
}

async function readMaxPositions(modelDir: string): Promise<number | null> {
  try {
    const config = JSON.parse(
      await readFile(path.join(modelDir, "config.json"), "utf8"),
    ) as { max_position_embeddings?: unknown };
    const value = config.max_position_embeddings;
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function defaultFactory(
  modelDir: string,
  dtype: Dtype,
): Promise<TextGenerator> {
  const { pipeline } = await import("@huggingface/transformers");
  return (await pipeline("text-generation", modelDir, {
    dtype,
    device: "cpu",
  })) as unknown as TextGenerator;
}

function getPipeline(modelDir: string, dtype: Dtype): Promise<TextGenerator> {
  let loaded = pipelines.get(modelDir);
  if (!loaded) {
    setStatus(modelDir, { loading: true });
    loaded = (factoryOverride ?? defaultFactory)(modelDir, dtype).then(
      (generator) => {
        setStatus(modelDir, {
          loaded: true,
          loading: false,
          lastError: undefined,
        });
        return generator;
      },
      (error: unknown) => {
        pipelines.delete(modelDir);
        setStatus(modelDir, {
          loaded: false,
          loading: false,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      },
    );
    pipelines.set(modelDir, loaded);
  }
  return loaded;
}

function fakeReview(messages: ChatMessage[]): string {
  const text = messages.map((m) => m.content).join("\n");
  if (text.includes("findingsTable")) {
    return JSON.stringify({
      summary: "Fake inference: canned review for tests.",
      overallRisk: "low",
      confidence: 0.5,
      findingsTable: [
        {
          category: "maintainability",
          finding: "Canned finding",
          evidence: "not observed",
          severity: "low",
          recommendation: "None",
        },
      ],
      performanceTable: [],
      securityTable: [],
      testingTable: [],
      rewrittenProcedure: "-- unchanged",
      limitations: ["Fake inference mode; no model was run."],
    });
  }
  return JSON.stringify({
    summary: "Fake inference: canned review for tests.",
    issues: [
      {
        severity: "low",
        title: "Canned finding",
        explanation: "Fake inference mode; no model was run.",
        recommendation: "None",
      },
    ],
    rewrittenProcedure: "-- unchanged",
    confidence: 0.5,
  });
}

async function runGeneration(
  modelDir: string,
  messages: ChatMessage[],
  opts: GenerateOptions,
  stopper: { interrupt?: () => void },
): Promise<GenerateResult> {
  const dtype = await detectDtype(modelDir);
  const generator = await getPipeline(modelDir, dtype);

  const promptText =
    generator.tokenizer?.apply_chat_template?.(messages, {
      tokenize: false,
      add_generation_prompt: true,
    }) ?? messages.map((m) => m.content).join("\n\n");

  const config = await readAppConfig();
  const maxPositions = await readMaxPositions(modelDir);
  const limit = Math.min(
    opts.contextWindow ?? config.contextWindow,
    maxPositions ?? Number.POSITIVE_INFINITY,
  );
  const encoded = generator.tokenizer?.encode?.(promptText);
  // Without a tokenizer fall back to a conservative 3 chars/token estimate.
  const promptTokens = encoded
    ? encoded.length
    : Math.ceil(promptText.length / 3);
  const remaining = limit - promptTokens;
  if (remaining < Math.min(MIN_NEW_TOKENS, opts.maxNewTokens)) {
    throw new PromptTooLargeError(promptTokens, limit);
  }

  let criteria: unknown;
  if (!factoryOverride) {
    const { InterruptableStoppingCriteria } = await import(
      "@huggingface/transformers"
    );
    const instance = new InterruptableStoppingCriteria();
    stopper.interrupt = () => instance.interrupt();
    if (opts.signal?.aborted) instance.interrupt();
    criteria = instance;
  }

  const sample = opts.temperature > 0;
  const budget = Math.min(opts.maxNewTokens, remaining);
  const output = await generator(promptText, {
    max_new_tokens: budget,
    ...(sample ? { temperature: opts.temperature } : {}),
    do_sample: sample,
    return_full_text: false,
    ...(criteria ? { stopping_criteria: criteria } : {}),
  });

  const text = output[0]?.generated_text?.trim() ?? "";
  // Re-encoding can differ by a few tokens from what was generated.
  const outputTokens = generator.tokenizer?.encode?.(text)?.length ?? Math.ceil(text.length / 3);
  return { text, hitTokenLimit: outputTokens >= budget - 8 };
}

/**
 * Runs one generation at a time. A second concurrent call throws
 * InferenceBusyError; the slot stays held after a timeout until the
 * underlying generation really finishes, so CPU work never overlaps.
 */
export async function generateText(
  modelDir: string,
  messages: ChatMessage[],
  opts: GenerateOptions,
): Promise<string> {
  return (await generateTextDetailed(modelDir, messages, opts)).text;
}

export async function generateTextDetailed(
  modelDir: string,
  messages: ChatMessage[],
  opts: GenerateOptions,
): Promise<GenerateResult> {
  if (busy) throw new InferenceBusyError();

  if (isFakeInferenceEnabled()) {
    return { text: fakeReview(messages), hitTokenLimit: false };
  }

  busy = true;
  const stopper: { interrupt?: () => void } = {};
  const onAbort = () => stopper.interrupt?.();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const work = runGeneration(modelDir, messages, opts, stopper);
  work.then(
    () => {
      busy = false;
    },
    (error: unknown) => {
      busy = false;
      if (!(error instanceof PromptTooLargeError)) {
        setStatus(modelDir, {
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stopper.interrupt?.();
      setStatus(modelDir, { lastError: `Inference timed out after ${opts.timeoutMs} ms` });
      reject(new InferenceTimeoutError(opts.timeoutMs));
    }, opts.timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
