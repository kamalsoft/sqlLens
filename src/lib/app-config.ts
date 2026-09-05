import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type AppConfig = {
  provider: string;
  defaultModel: string;
  downloadDirectory: string;
  autoDownload: boolean;
  autoUpdateModels: boolean;
  maxConcurrentDownloads: number;
  temperature: number;
  contextWindow: number;
  apiKey: string;
  allowTelemetry: boolean;
};

export const defaultAppConfig: AppConfig = {
  provider: "Hugging Face",
  defaultModel: "microsoft/Phi-3-mini-4k-instruct",
  downloadDirectory: "~/models",
  autoDownload: true,
  autoUpdateModels: true,
  maxConcurrentDownloads: 2,
  temperature: 0.2,
  contextWindow: 128000,
  apiKey: "",
  allowTelemetry: false,
};

const configPath = path.join(process.cwd(), "data", "appconfig.json");

export async function readAppConfig(): Promise<AppConfig> {
  try {
    const contents = await readFile(configPath, "utf8");
    return {
      ...defaultAppConfig,
      ...JSON.parse(contents),
    };
  } catch {
    await writeAppConfig(defaultAppConfig);
    return defaultAppConfig;
  }
}

export async function writeAppConfig(
  changes: Partial<AppConfig>
): Promise<AppConfig> {
  const current = await readAppConfig().catch(() => defaultAppConfig);
  const next: AppConfig = {
    ...current,
    ...changes,
  };

  await mkdir(path.dirname(configPath), { recursive: true });

  const temporaryPath = `${configPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(next, null, 2), "utf8");
  await rename(temporaryPath, configPath);

  return next;
}