import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAppConfig } from "@/lib/app-config";
import { isSmallModel, readParameterEstimate } from "@/lib/model-size";

type ModelMetadata = {
  modelId?: string;
  id?: string;
};

export type InstalledModel = {
  id: string;
  name: string;
  directory: string;
  compatible: boolean;
  /** Estimated parameters from config.json, or null when unknown. */
  parameterEstimate: number | null;
  /** True when the estimate is known and under 1B. */
  small: boolean;
  /** True when the tokenizer has a chat template, so prompts are sent in the chat format the model was tuned on. */
  chatTemplate: boolean;
};

const ONNX_MODEL_NAMES = new Set([
  "model.onnx",
  "model_quantized.onnx",
  "model_q4.onnx",
  "model_fp16.onnx",
]);

/** A chat template in tokenizer_config.json, or a separate chat_template.jinja / chat_template.json. */
async function hasChatTemplate(directory: string): Promise<boolean> {
  for (const file of ["chat_template.jinja", "chat_template.json"]) {
    try {
      await stat(path.join(directory, file));
      return true;
    } catch { /* not there */ }
  }
  try {
    const config = JSON.parse(await readFile(path.join(directory, "tokenizer_config.json"), "utf8")) as { chat_template?: unknown };
    return typeof config.chat_template === "string" || Array.isArray(config.chat_template);
  } catch {
    return false;
  }
}

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
  const config = await readAppConfig();

  const downloadDirectory = expandHome(config.downloadDirectory);
  const entries = await readdir(downloadDirectory, {
    withFileTypes: true,
  }).catch(() => []);
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

      if (!id) {
        continue;
      }

      const parameterEstimate = await readParameterEstimate(directory);
      const chatTemplate = await hasChatTemplate(directory);
      models.push({
        id,
        name: id,
        directory,
        compatible: true,
        parameterEstimate,
        small: isSmallModel(parameterEstimate),
        chatTemplate,
      });
    } catch {
      // Ignore incomplete or non-ONNX model directories.
    }
  }

  return models.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/** Instruction-tuned models follow the refactor prompt; a base model of the same size only continues text. */
const INSTRUCT_NAME = /instruct|[-_]chat\b|[-_]it\b/i;

/**
 * The model a refactor or review uses: the configured one when it is installed and compatible, otherwise the best
 * automatic choice. Automatic ranks models with a chat template first (without one, prompts cannot be sent
 * in the chat format), then instruction-tuned names (Instruct, -chat, -it) over base models, then the larger
 * parameter estimate. A model of unknown size ranks last on size; ties keep the list's name order.
 * Null when no compatible model is installed.
 */
export function chooseRefactorModel<
  T extends { id: string; compatible: boolean; parameterEstimate: number | null; chatTemplate?: boolean },
>(models: T[], configured: string): T | null {
  const usable = models.filter((m) => m.compatible);
  const chosen = configured ? usable.find((m) => m.id === configured) : undefined;
  if (chosen) return chosen;
  const rank = (m: T) => [m.chatTemplate === false ? 0 : 1, INSTRUCT_NAME.test(m.id) ? 1 : 0, m.parameterEstimate ?? 0];
  return [...usable].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2];
  })[0] ?? null;
}
