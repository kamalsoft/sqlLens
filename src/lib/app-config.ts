import "server-only";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type Engine = "simulation" | "mssql" | "postgres";

export type AppConfig = {
  provider: "local";
  defaultModel: string;
  downloadDirectory: string;
  autoDownload: boolean;
  autoUpdateModels: boolean;
  maxConcurrentDownloads: number;
  temperature: number;
  contextWindow: number;
  allowTelemetry: boolean;
  prompt?: Record<string, string>;
  allowLiveExecution: boolean;
  queryTimeoutMs: number;
  defaultEngine: Engine;
  maxSqlLength: number;
  inferenceTimeoutMs: number;
  maxNewTokens: number;
  logSqlText: boolean;
  shareTtlHours: number;
};

export const defaultAppConfig: AppConfig = {
  provider: "local",
  defaultModel: "onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
  downloadDirectory: "~/models",
  autoDownload: true,
  autoUpdateModels: true,
  maxConcurrentDownloads: 2,
  temperature: 0.2,
  contextWindow: 128000,
  allowTelemetry: false,
  allowLiveExecution: false,
  queryTimeoutMs: 30000,
  defaultEngine: "simulation",
  maxSqlLength: 100000,
  inferenceTimeoutMs: 120000,
  maxNewTokens: 1536,
  logSqlText: true,
  shareTtlHours: 24,
};

type Rule = (v: unknown) => boolean;
export function resolveDownloadDirectory(value: string): string {
  const home = os.homedir();
  const expanded = value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
  return path.resolve(expanded);
}

/** realpath of the nearest existing ancestor, with the non-existent tail re-appended. */
function realpathNearest(p: string): string {
  const tail: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

function underHome(home: string, target: string): boolean {
  if (target === home || !target.startsWith(home + path.sep)) return false;
  // Reject dot-directories (~/.ssh, ~/.aws, ...) directly under home.
  return !path.relative(home, target).split(path.sep)[0].startsWith(".");
}

const safeDirectory: Rule = (v) => {
  if (typeof v !== "string" || v.length === 0 || v.length > 1024 || v.includes("\0")) return false;
  const home = path.resolve(os.homedir());
  const resolved = resolveDownloadDirectory(v);
  if (!path.isAbsolute(resolved) || !underHome(home, resolved)) return false;
  let realHome: string;
  try {
    realHome = realpathSync(home);
  } catch {
    return false;
  }
  return underHome(realHome, realpathNearest(resolved));
};

const str: Rule = (v) => typeof v === "string" && v.length > 0 && v.length <= 1024;
const bool: Rule = (v) => typeof v === "boolean";
const int =
  (min: number, max: number): Rule =>
  (v) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const num =
  (min: number, max: number): Rule =>
  (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

const rules: Record<keyof AppConfig, Rule> = {
  provider: (v) => v === "local",
  defaultModel: str,
  downloadDirectory: safeDirectory,
  autoDownload: bool,
  autoUpdateModels: bool,
  maxConcurrentDownloads: int(1, 8),
  temperature: num(0, 2),
  contextWindow: int(1, 10_000_000),
  allowTelemetry: bool,
  prompt: (v) =>
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "string"),
  allowLiveExecution: bool,
  queryTimeoutMs: int(1000, 600_000),
  defaultEngine: (v) => v === "simulation" || v === "mssql" || v === "postgres",
  maxSqlLength: int(1, 5_000_000),
  inferenceTimeoutMs: int(1000, 3_600_000),
  maxNewTokens: int(64, 8192),
  logSqlText: bool,
  shareTtlHours: int(1, 720),
};

/**
 * Validates a partial config. Unknown keys (including legacy `apiKey`) are
 * ignored; known keys with a bad type/range yield `{ ok:false, field }`.
 */
export function validateConfigChanges(
  input: Record<string, unknown>
): { ok: true; changes: Partial<AppConfig> } | { ok: false; field: string } {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(rules) as (keyof AppConfig)[]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    if (!rules[key](input[key])) return { ok: false, field: key };
    changes[key] = input[key];
  }
  return { ok: true, changes: changes as Partial<AppConfig> };
}

function configPath(): string {
  // SQLLENS_CONFIG_PATH lets tests avoid touching the real data/appconfig.json.
  return process.env.SQLLENS_CONFIG_PATH
    ? path.resolve(process.env.SQLLENS_CONFIG_PATH)
    : path.join(process.cwd(), "data", "appconfig.json");
}

function sanitize(raw: unknown): AppConfig {
  const merged: Record<string, unknown> = { ...defaultAppConfig };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of Object.keys(rules) as (keyof AppConfig)[]) {
      // Invalid or legacy values (e.g. provider "Hugging Face") fall back to defaults.
      if (key in obj && rules[key](obj[key])) merged[key] = obj[key];
    }
  }
  return merged as AppConfig;
}

export async function readAppConfig(): Promise<AppConfig> {
  try {
    const contents = await readFile(configPath(), "utf8");
    return sanitize(JSON.parse(contents));
  } catch {
    return { ...defaultAppConfig };
  }
}

export async function writeAppConfig(changes: Partial<AppConfig>): Promise<AppConfig> {
  const current = await readAppConfig();
  const next: AppConfig = { ...current, ...changes };

  await mkdir(path.dirname(configPath()), { recursive: true });
  const temporaryPath = `${configPath()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(next, null, 2), "utf8");
  await rename(temporaryPath, configPath());

  return next;
}
