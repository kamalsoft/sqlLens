import "server-only";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
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
  /** After a timeout, how long the worker gets to stop before it is killed (tests). */
  killGraceMs?: number;
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

export class InferenceCrashedError extends Error {
  constructor(reason: string) {
    super(`The model runtime stopped unexpectedly (${reason}). The server is still running; try again.`);
    this.name = "InferenceCrashedError";
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
const KILL_GRACE_MS = 10_000;

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

// Real generation runs in scripts/inference-worker.mjs, a plain Node child process: onnxruntime's SME2
// kernels crash the Next server itself (SIGILL) on Apple M5. See the worker for the details.
type WorkerReply =
  | { id: number; ok: true; text: string; hitTokenLimit: boolean }
  | { id: number; ok: false; error: { name: string; message: string; promptTokens?: number; limit?: number } };

let worker: ChildProcess | null = null;
let pending: { id: number; child: ChildProcess; resolve: (r: WorkerReply) => void; reject: (e: Error) => void } | null = null;
let nextId = 1;
let exitHookSet = false;

function getWorker(): ChildProcess {
  if (worker) return worker;
  // The worker ships with the app: a build that leaves out scripts/ cannot run models.
  const script = path.join(/* turbopackIgnore: true */ process.cwd(), "scripts", "inference-worker.mjs");
  if (!existsSync(script)) throw new Error("Model worker scripts/inference-worker.mjs not found; scripts/ must ship with the app.");
  // Only what the runtime needs: no tokens, credentials or connection strings reach the worker.
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot; // Windows needs it to start node
  if (process.env.NODE_ENV === "test" && process.env.SQLLENS_TRANSFORMERS_MODULE) {
    env.SQLLENS_TRANSFORMERS_MODULE = process.env.SQLLENS_TRANSFORMERS_MODULE;
  }
  const child = fork(script, [], {
    execArgv: [],
    env,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  child.on("message", (msg: WorkerReply) => {
    if (pending?.id === msg.id) {
      const done = pending;
      pending = null;
      done.resolve(msg);
    }
  });
  child.on("exit", (code, signal) => {
    if (worker === child) worker = null;
    // Loaded models went with the process.
    for (const dir of status.keys()) setStatus(dir, { loaded: false, loading: false });
    if (pending) {
      const done = pending;
      pending = null;
      done.reject(new InferenceCrashedError(signal ?? `exit code ${code}`));
    }
  });
  child.on("error", (error) => {
    if (pending?.child === child) {
      const done = pending;
      pending = null;
      done.reject(error);
    }
  });
  worker = child;
  // A long native call can delay the worker's own disconnect exit; stop it with the server.
  if (!exitHookSet) {
    exitHookSet = true;
    process.once("exit", () => worker?.kill("SIGKILL"));
  }
  return child;
}

async function runInWorker(
  modelDir: string,
  messages: ChatMessage[],
  opts: GenerateOptions,
  stopper: { interrupt?: () => void },
): Promise<GenerateResult> {
  const dtype = await detectDtype(modelDir);
  const config = await readAppConfig();
  const maxPositions = await readMaxPositions(modelDir);
  const limit = Math.min(opts.contextWindow ?? config.contextWindow, maxPositions ?? Number.POSITIVE_INFINITY);
  const child = getWorker();
  const id = nextId++;
  if (!status.get(modelDir)?.loaded) setStatus(modelDir, { loading: true });
  const reply = await new Promise<WorkerReply>((resolve, reject) => {
    pending = { id, child, resolve, reject };
    child.send({
      id, type: "generate", modelDir, dtype, messages, limit,
      maxNewTokens: opts.maxNewTokens, minNewTokens: MIN_NEW_TOKENS, temperature: opts.temperature,
    });
    stopper.interrupt = () => { if (child.connected) child.send({ type: "interrupt" }); };
    if (opts.signal?.aborted) stopper.interrupt();
  });
  if (reply.ok) {
    setStatus(modelDir, { loaded: true, loading: false, lastError: undefined });
    return { text: reply.text, hitTokenLimit: reply.hitTokenLimit };
  }
  setStatus(modelDir, { loading: false });
  if (reply.error.name === "PromptTooLargeError") {
    throw new PromptTooLargeError(reply.error.promptTokens ?? 0, reply.error.limit ?? 0);
  }
  throw new Error(reply.error.message);
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

// Keep in step with generate() in scripts/inference-worker.mjs (prompt template, token budget, hitTokenLimit).
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
  // The test factory runs in-process; real models run in the worker.
  const work = factoryOverride
    ? runGeneration(modelDir, messages, opts, stopper)
    : runInWorker(modelDir, messages, opts, stopper);
  // A worker that does not stop after a timeout is killed; its exit frees the slot.
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  work.then(
    () => {
      clearTimeout(killTimer);
      busy = false;
    },
    (error: unknown) => {
      clearTimeout(killTimer);
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
      if (!factoryOverride) {
        const hung = worker;
        killTimer = setTimeout(() => hung?.kill("SIGKILL"), opts.killGraceMs ?? KILL_GRACE_MS);
      }
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
