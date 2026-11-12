import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InferenceCrashedError, InferenceTimeoutError, PromptTooLargeError, generateTextDetailed, getModelStatus } from "@/lib/inference";

// Real child process, fake model library: covers the IPC, crash isolation and interrupt paths.
const modelDir = mkdtempSync(path.join(os.tmpdir(), "sqllens-worker-"));
mkdirSync(path.join(modelDir, "onnx"));
writeFileSync(path.join(modelDir, "onnx", "model_quantized.onnx"), "x");
writeFileSync(path.join(modelDir, "config.json"), "{}");

const ask = (content: string, extra: object = {}) =>
  generateTextDetailed(modelDir, [{ role: "user", content }], { maxNewTokens: 100, temperature: 0, timeoutMs: 20_000, contextWindow: 10_000, ...extra });

describe("inference worker process", () => {
  beforeAll(() => { process.env.SQLLENS_TRANSFORMERS_MODULE = path.resolve("tests/fixtures/fake-transformers.mjs"); });
  afterAll(() => { delete process.env.SQLLENS_TRANSFORMERS_MODULE; });

  it("generates in the worker with the chat template", async () => {
    await expect(ask("hello")).resolves.toEqual({ text: "echo:user:hello", hitTokenLimit: false });
    expect(getModelStatus()[modelDir]).toMatchObject({ loaded: true, loading: false });
  });

  it("a runtime crash fails only the run; the next run starts a new worker", async () => {
    await expect(ask("CRASH")).rejects.toBeInstanceOf(InferenceCrashedError);
    await expect(ask("CRASH")).rejects.toThrow(/SIGILL/);
    await expect(ask("again")).resolves.toMatchObject({ text: "echo:user:again" });
  });

  it("an abort interrupts the generation", async () => {
    const controller = new AbortController();
    const run = ask("WAIT", { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(run).resolves.toMatchObject({ text: "stopped" });
  });

  it("a worker that ignores the timeout is killed, which frees the slot for the next run", async () => {
    await expect(ask("HANG", { timeoutMs: 100, killGraceMs: 100 })).rejects.toBeInstanceOf(InferenceTimeoutError);
    // Busy until the kill lands, then a new worker answers.
    await expect.poll(() => ask("after").then((r) => r.text, (e: Error) => e.name), { timeout: 10_000, interval: 200 }).toBe("echo:user:after");
  });

  it("reports a prompt larger than the context window", async () => {
    await expect(ask("x".repeat(500), { contextWindow: 100 })).rejects.toBeInstanceOf(PromptTooLargeError);
  });
});
