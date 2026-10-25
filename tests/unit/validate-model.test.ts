import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateDownloadedModel } from "@/lib/validate-model";

describe("validateDownloadedModel", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "sqllens-model-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reports every required file missing for an empty directory", async () => {
    const result = await validateDownloadedModel(directory);

    expect(result.valid).toBe(false);
    expect(result.compatible).toBe(false);
    expect(result.missing).toEqual([
      "sqlens-model.json",
      "config.json",
      "tokenizer.json",
      "onnx/*.onnx",
    ]);
  });

  it("accepts a complete ONNX model directory", async () => {
    await mkdir(path.join(directory, "onnx"));
    for (const file of ["sqlens-model.json", "config.json", "tokenizer.json", "onnx/model_q4.onnx"]) {
      await writeFile(path.join(directory, file), "{}");
    }

    const result = await validateDownloadedModel(directory);

    expect(result.valid).toBe(true);
    expect(result.compatible).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects a path that does not exist", async () => {
    const result = await validateDownloadedModel(path.join(directory, "missing"));

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["model directory"]);
  });
});
