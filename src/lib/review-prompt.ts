import { readFile } from "node:fs/promises";
import { resolvePromptPath } from "@/lib/prompt-path";
import type { SchemaVersion } from "@/lib/review-schema";

export type LoadedPrompt = { path: string; content: string };

const PLACEHOLDER = "{{STORED_PROCEDURE}}";
const MAX_PROMPT_CHARS = 30_000;

/** Picks the prompt file for a schema version: the configured one when allowed (SEC-2), else the bundled file. */
export function selectPromptPath(
  version: SchemaVersion,
  prompts?: Record<string, string>,
  cwd: string = process.cwd(),
): string {
  return version === "v1"
    ? resolvePromptPath(prompts?.analysisSPv1, "analysisSP.v1.md", cwd)
    : resolvePromptPath(prompts?.analysisSP, "analysisSP.md", cwd);
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
