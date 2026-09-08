import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type AppConfig = {
  downloadDirectory?: string;
};

type ModelMetadata = {
  modelId?: string;
  id?: string;
};

export type InstalledModel = {
  id: string;
  name: string;
  directory: string;
  compatible: boolean;
};

const ONNX_MODEL_NAMES = new Set([
  "model.onnx",
  "model_quantized.onnx",
  "model_q4.onnx",
]);

function expandHome(value: string): string {
  return value === "~"
    ? os.homedir()
    : value.startsWith("~/")
      ? path.join(os.homedir(), value.slice(2))
      : value;
}

async function hasOnnxModel(directory: string): Promise<boolean> {
  try {
    const files = await readdir(path.join(directory, "onnx"));
    return files.some((file) => ONNX_MODEL_NAMES.has(file));
  } catch {
    return false;
  }
}

async function readModelId(directory: string, directoryName: string) {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(directory, "sqlens-model.json"), "utf8"),
    ) as ModelMetadata;

    if (metadata.modelId || metadata.id) {
      return metadata.modelId ?? metadata.id;
    }
  } catch {
    // Fall back to the directory name.
  }

  const separator = directoryName.indexOf("_");

  return separator > 0
    ? `${directoryName.slice(0, separator)}/${directoryName.slice(separator + 1)}`
    : directoryName;
}

export async function getInstalledModels(): Promise<InstalledModel[]> {
  const configPath = path.join(process.cwd(), "data", "appconfig.json");
  const config = JSON.parse(
    await readFile(configPath, "utf8"),
  ) as AppConfig;

  if (!config.downloadDirectory) {
    throw new Error("downloadDirectory is missing from appconfig.json");
  }

  const downloadDirectory = expandHome(config.downloadDirectory);
  const entries = await readdir(downloadDirectory, { withFileTypes: true });
  const models: InstalledModel[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const directory = path.join(downloadDirectory, entry.name);

    try {
      await stat(path.join(directory, "config.json"));

      if (!(await hasOnnxModel(directory))) {
        continue;
      }

      const id = await readModelId(directory, entry.name);

      models.push({
        id,
        name: id,
        directory,
        compatible: true,
      });
    } catch {
      // Ignore incomplete or non-ONNX model directories.
    }
  }

  return models.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}