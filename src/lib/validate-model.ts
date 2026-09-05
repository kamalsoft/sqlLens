import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

export type ModelValidation = {
  valid: boolean;
  compatible: boolean;
  files: string[];
  missing: string[];
  reason?: string;
};

async function collectFiles(
  directory: string,
  current = directory
): Promise<string[]> {
  const result: string[] = [];

  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await collectFiles(directory, fullPath)));
    } else {
      result.push(path.relative(directory, fullPath).split(path.sep).join("/"));
    }
  }

  return result;
}

export async function validateDownloadedModel(
  directory: string
): Promise<ModelValidation> {
  try {
    const directoryInfo = await stat(directory);

    if (!directoryInfo.isDirectory()) {
      return {
        valid: false,
        compatible: false,
        files: [],
        missing: ["model directory"],
        reason: "Downloaded model path is not a directory.",
      };
    }

    const files = await collectFiles(directory);
    const fileSet = new Set(files);

    const hasOnnx = files.some(
      (file) => file.startsWith("onnx/") && file.endsWith(".onnx")
    );

    const hasMetadata = fileSet.has("sqlens-model.json");
    const hasConfig = fileSet.has("config.json");
    const hasTokenizer = fileSet.has("tokenizer.json");

    const missing: string[] = [];

    if (!hasMetadata) missing.push("sqlens-model.json");
    if (!hasConfig) missing.push("config.json");
    if (!hasTokenizer) missing.push("tokenizer.json");
    if (!hasOnnx) missing.push("onnx/*.onnx");

    return {
      valid: missing.length === 0,
      compatible: hasConfig && hasTokenizer && hasOnnx,
      files,
      missing,
      reason:
        missing.length > 0
          ? `Missing required files: ${missing.join(", ")}`
          : undefined,
    };
  } catch {
    return {
      valid: false,
      compatible: false,
      files: [],
      missing: ["model directory"],
      reason: "Unable to inspect the downloaded model.",
    };
  }
}