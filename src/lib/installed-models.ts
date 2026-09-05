import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveDownloadDirectory } from "@/lib/model-path";

export type InstalledModel = {
  id: string;
  name: string;
  directory: string;
  sourceUrl?: string;
  compatible: boolean;
};

async function hasOnnxModel(directory: string) {
  try {
    const files = await readdir(path.join(directory, "onnx"));
    return files.some((file) => file.endsWith(".onnx"));
  } catch {
    return false;
  }
}

export async function getInstalledModels(): Promise<InstalledModel[]> {
  const root = await resolveDownloadDirectory();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const models: InstalledModel[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const directory = path.join(root, entry.name);

    try {
      const metadata = JSON.parse(
        await readFile(path.join(directory, "sqlens-model.json"), "utf8")
      ) as {
        id?: string;
        name?: string;
        sourceUrl?: string;
      };

      if (!metadata.id) continue;

      models.push({
        id: metadata.id,
        name: metadata.name || metadata.id,
        directory,
        sourceUrl: metadata.sourceUrl,
        compatible: await hasOnnxModel(directory),
      });
    } catch {
      // Ignore directories without valid SQLLens metadata.
    }
  }

  return models;
}