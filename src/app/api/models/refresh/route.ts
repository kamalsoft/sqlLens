import { NextResponse } from "next/server";
import { access, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAppConfig } from "@/lib/app-config";
import { requireSession } from "@/lib/auth";

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
    id: "onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
    name: "Qwen2.5 0.5B Instruct (ONNX)",
    provider: "Hugging Face",
    version: "latest",
    size: "Repository",
    status: "available",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
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

export async function GET(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

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
