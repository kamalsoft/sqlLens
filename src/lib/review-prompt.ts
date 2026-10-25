import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SchemaVersion } from "@/lib/review-schema";

export type LoadedPrompt = { path: string; content: string };

const PLACEHOLDER = "{{STORED_PROCEDURE}}";
const MAX_PROMPT_CHARS = 30_000;

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** Picks the prompt file for a schema version (v1 falls back to the bundled file). */
export function selectPromptPath(
  version: SchemaVersion,
  prompts?: Record<string, string>,
  cwd: string = process.cwd(),
): string {
  if (version === "v1") {
    const configured = prompts?.analysisSPv1;
    return configured
      ? expandHome(configured)
      : path.join(cwd, "data", "prompts", "analysisSP.v1.md");
  }

  const configured = prompts?.analysisSP;
  if (!configured) {
    throw new Error("The analysisSP prompt path is not configured");
  }
  return expandHome(configured);
}

export async function loadPrompt(
  version: SchemaVersion,
  prompts?: Record<string, string>,
): Promise<LoadedPrompt> {
  const promptPath = selectPromptPath(version, prompts);
  const content = (await readFile(promptPath, "utf8")).trim();
  if (!content) throw new Error(`The analysis prompt is empty: ${promptPath}`);
  return { path: promptPath, content };
}

export function buildPrompt(template: string, sql: string): string {
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`Prompt must contain the ${PLACEHOLDER} placeholder`);
  }

  const procedure = ["<stored_procedure>", sql, "</stored_procedure>"].join("\n");
  const prompt = template.split(PLACEHOLDER).join(procedure);

  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Analysis prompt is too large: ${prompt.length} characters`);
  }
  return prompt;
}
