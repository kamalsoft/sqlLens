import { NextResponse } from "next/server";
import { access, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAppConfig } from "@/lib/app-config";

type ModelStatus = "installed" | "downloading" | "available" | "failed";

type ModelRecord = {
  id: string;
  name: string;
  provider: string;
  version: string;
  size: string;
  status: ModelStatus;
  path?: string | null;
  sourceUrl?: string;
  lastUsed?: string;
};

const defaultModels: ModelRecord[] = [
  {
    id: "microsoft/Phi-3-mini-4k-instruct",
    name: "Phi-3 Mini 4K Instruct",
    provider: "Hugging Face",
    version: "latest",
    size: "Repository",
    status: "available",
    sourceUrl: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct",
    lastUsed: "Never",
  },
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct",
    provider: "Hugging Face",
    version: "latest",
    size: "Repository",
    status: "available",
    sourceUrl: "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3",
    lastUsed: "Never",
  },
  {
    id: "Qwen/Qwen3.8-27B4",
    name: "Qwen3.8-27B4",
    provider: "Hugging Face",
    version: "latest",
    size: "Repository",
    status: "available",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3.8-27B",
    lastUsed: "Never",
  },
  {
    id: "Sana2030/sqlmind-lora6",
    name: "sqlmind-lora6",
    provider: "Hugging Face",
    version: "latest",
    size: "Repository",
    status: "available",
    sourceUrl: "https://huggingface.co/Sana2030/sqlmind-lora",
    lastUsed: "Never",
  },
{
    id: "defog/sqlcoder-7b-26",
    name: "sqlcoder-7b-26",
    provider: "Hugging Face",
    version: "latest",
    size: "Repository",
    status: "available",
    sourceUrl: "https://huggingface.co/defog/sqlcoder-7b-2",
    lastUsed: "Never",
  },

  
];

function resolveDirectory(value?: string) {
  const configured = value?.trim() || "~/models";

  return path.resolve(
    configured.startsWith("~/")
      ? path.join(os.homedir(), configured.slice(2))
      : configured
  );
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else {
      total += (await stat(entryPath)).size;
    }
  }

  return total;
}

export async function GET() {
  const config = await readAppConfig();
  const modelsDirectory = resolveDirectory(config.downloadDirectory);

  const installed = new Map<string, ModelRecord>();

  try {
    await access(modelsDirectory);

    for (const entry of await readdir(modelsDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;

      const modelDirectory = path.join(modelsDirectory, entry.name);
      const metadataPath = path.join(modelDirectory, "sqlens-model.json");

      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        const bytes = await directorySize(modelDirectory);

        installed.set(metadata.id, {
          id: metadata.id,
          name: metadata.name || metadata.id,
          provider: "Hugging Face",
          version: "installed",
          size: formatSize(bytes),
          status: "installed",
          path: modelDirectory,
          sourceUrl: metadata.sourceUrl,
          lastUsed: metadata.installedAt
            ? new Date(metadata.installedAt).toLocaleString()
            : "Never",
        });
      } catch {
        // Ignore directories that are not SQLLens model directories.
      }
    }
  } catch {
    // The configured directory may not exist yet.
  }

  const models: ModelRecord[] = defaultModels.map(
    (model): ModelRecord => installed.get(model.id) ?? model
  );

  for (const model of installed.values()) {
    if (!models.some((entry) => entry.id === model.id)) {
      models.push(model);
    }
  }

  return NextResponse.json({
    models,
    directory: modelsDirectory,
  });
}
