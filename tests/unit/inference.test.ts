import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  InferenceBusyError,
  InferenceTimeoutError,
  PromptTooLargeError,
  detectDtype,
  generateText,
  getModelStatus,
  setPipelineFactoryForTests,
  type TextGenerator,
} from "@/lib/inference";

function makeModelDir(files: string[], maxPositions?: number): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sqllens-model-"));
  mkdirSync(path.join(dir, "onnx"));
  for (const file of files) writeFileSync(path.join(dir, "onnx", file), "x");
  writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify(maxPositions ? { max_position_embeddings: maxPositions } : {}),
  );
  return dir;
}

const messages = [
  { role: "system" as const, content: "system" },
  { role: "user" as const, content: "user" },
];
const opts = { maxNewTokens: 700, temperature: 0, timeoutMs: 2000, contextWindow: 10_000 };

function fakeGenerator(
  impl: (prompt: string, options: Record<string, unknown>) => Promise<string>,
  tokens = 10,
): TextGenerator {
  const generator = (async (prompt: string, options: Record<string, unknown>) => [
    { generated_text: await impl(prompt, options) },
  ]) as unknown as TextGenerator;
  generator.tokenizer = {
    apply_chat_template: (m) => m.map((x) => x.content).join("|"),
    encode: () => new Array(tokens).fill(1),
  };
  return generator;
}

beforeEach(() => setPipelineFactoryForTests(null));
afterEach(() => {
  setPipelineFactoryForTests(null);
  vi.unstubAllEnvs();
});

describe("dtype selection", () => {
  it.each([
    [["model_q4.onnx", "model.onnx"], "q4"],
    [["model_quantized.onnx", "model.onnx"], "q8"],
    [["model.onnx"], "fp32"],
    [["model_fp16.onnx"], "fp16"],
  ])("%j -> %s", async (files, dtype) => {
    expect(await detectDtype(makeModelDir(files))).toBe(dtype);
  });

  it("passes the detected dtype to the factory", async () => {
    const dir = makeModelDir(["model_quantized.onnx"]);
    const factory = vi.fn(async () => fakeGenerator(async () => "ok"));
    setPipelineFactoryForTests(factory);
    await generateText(dir, messages, opts);
    expect(factory).toHaveBeenCalledWith(dir, "q8");
  });

  it("rejects a directory without ONNX files", async () => {
    setPipelineFactoryForTests(async () => fakeGenerator(async () => "ok"));
    await expect(generateText(makeModelDir([]), messages, opts)).rejects.toThrow(/ONNX/);
  });
});

describe("generation options", () => {
  it("disables sampling at temperature 0 and enables it above 0", async () => {
    const seen: Record<string, unknown>[] = [];
    setPipelineFactoryForTests(async () =>
      fakeGenerator(async (_p, o) => {
        seen.push(o);
        return "ok";
      }),
    );
    const dir = makeModelDir(["model_q4.onnx"]);
    await generateText(dir, messages, { ...opts, temperature: 0 });
    await generateText(dir, messages, { ...opts, temperature: 0.4 });
    expect(seen[0]).toMatchObject({ do_sample: false, max_new_tokens: 700 });
    expect(seen[0]).not.toHaveProperty("temperature");
    expect(seen[1]).toMatchObject({ do_sample: true, temperature: 0.4 });
  });

  it("reuses the cached pipeline and reports status", async () => {
    const dir = makeModelDir(["model_q4.onnx"]);
    const factory = vi.fn(async () => fakeGenerator(async () => "ok"));
    setPipelineFactoryForTests(factory);
    await generateText(dir, messages, opts);
    await generateText(dir, messages, opts);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(getModelStatus()[dir]).toMatchObject({ loaded: true, loading: false });
  });

  it("records a load failure and retries on the next call", async () => {
    const dir = makeModelDir(["model_q4.onnx"]);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(fakeGenerator(async () => "ok"));
    setPipelineFactoryForTests(factory);
    await expect(generateText(dir, messages, opts)).rejects.toThrow("boom");
    expect(getModelStatus()[dir]).toMatchObject({ loaded: false, lastError: "boom" });
    await expect(generateText(dir, messages, opts)).resolves.toBe("ok");
  });
});

describe("context window", () => {
  it("rejects when the prompt exceeds the configured window", async () => {
    setPipelineFactoryForTests(async () => fakeGenerator(async () => "ok", 950));
    const dir = makeModelDir(["model_q4.onnx"]);
    await expect(
      generateText(dir, messages, { ...opts, contextWindow: 1000 }),
    ).rejects.toBeInstanceOf(PromptTooLargeError);
  });

  it("uses max_position_embeddings when it is smaller than the config window", async () => {
    setPipelineFactoryForTests(async () => fakeGenerator(async () => "ok", 600));
    const dir = makeModelDir(["model_q4.onnx"], 640);
    await expect(
      generateText(dir, messages, { ...opts, contextWindow: 100_000 }),
    ).rejects.toBeInstanceOf(PromptTooLargeError);
  });

  it("shrinks max_new_tokens to fit the remaining window", async () => {
    let seen = 0;
    setPipelineFactoryForTests(async () =>
      fakeGenerator(async (_p, o) => {
        seen = o.max_new_tokens as number;
        return "ok";
      }, 900),
    );
    const dir = makeModelDir(["model_q4.onnx"]);
    await generateText(dir, messages, { ...opts, contextWindow: 1000 });
    expect(seen).toBe(100);
  });
});

describe("timeout and busy", () => {
  it("times out, stays busy until the work ends, then recovers", async () => {
    let release: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    setPipelineFactoryForTests(async () => fakeGenerator(() => slow));
    const dir = makeModelDir(["model_q4.onnx"]);

    await expect(
      generateText(dir, messages, { ...opts, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(InferenceTimeoutError);
    await expect(generateText(dir, messages, opts)).rejects.toBeInstanceOf(InferenceBusyError);

    release("late");
    await new Promise((resolve) => setTimeout(resolve, 10));
    setPipelineFactoryForTests(async () => fakeGenerator(async () => "fresh"));
    await expect(generateText(dir, messages, opts)).resolves.toBe("fresh");
  });

  it("throws InferenceBusyError for a concurrent call", async () => {
    let release: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    setPipelineFactoryForTests(async () => fakeGenerator(() => slow));
    const dir = makeModelDir(["model_q4.onnx"]);
    const first = generateText(dir, messages, opts);
    await expect(generateText(dir, messages, opts)).rejects.toBeInstanceOf(InferenceBusyError);
    release("done");
    await expect(first).resolves.toBe("done");
  });
});

describe("fake inference mode (D-029)", () => {
  it("returns canned JSON per schema version without touching the pipeline", async () => {
    vi.stubEnv("SQLLENS_FAKE_INFERENCE", "1");
    const factory = vi.fn();
    setPipelineFactoryForTests(factory);
    const v2 = JSON.parse(
      await generateText("/missing", [{ role: "system", content: "findingsTable" }], opts),
    );
    const v1 = JSON.parse(
      await generateText("/missing", [{ role: "system", content: "issues" }], opts),
    );
    expect(v2).toHaveProperty("findingsTable");
    expect(v1).toHaveProperty("issues");
    expect(factory).not.toHaveBeenCalled();
  });

  it("is ignored in production", async () => {
    vi.stubEnv("SQLLENS_FAKE_INFERENCE", "1");
    vi.stubEnv("NODE_ENV", "production");
    const factory = vi.fn(async () => fakeGenerator(async () => "real"));
    setPipelineFactoryForTests(factory);
    const dir = makeModelDir(["model_q4.onnx"]);
    await expect(generateText(dir, messages, opts)).resolves.toBe("real");
    expect(factory).toHaveBeenCalled();
  });

  it("is off by default", async () => {
    const factory = vi.fn(async () => fakeGenerator(async () => "real"));
    setPipelineFactoryForTests(factory);
    const dir = makeModelDir(["model_q4.onnx"]);
    await expect(generateText(dir, messages, opts)).resolves.toBe("real");
  });
});
