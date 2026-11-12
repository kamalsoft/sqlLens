import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/**
 * SEC-2: a configured prompt must be an existing .md file inside data/prompts/ (symlinks resolved).
 * The prompt text is stored in audit records, so any other path would let a setting read arbitrary files.
 * Returns the real path, or null when the value is not allowed.
 */
export function allowedPromptPath(value: unknown, cwd: string = process.cwd()): string | null {
  if (typeof value !== "string" || value.length > 1024 || !value.toLowerCase().endsWith(".md")) return null;
  try {
    const root = realpathSync(path.join(cwd, "data", "prompts"));
    const real = realpathSync(path.resolve(cwd, expandHome(value)));
    return real.startsWith(root + path.sep) ? real : null;
  } catch {
    return null;
  }
}

/** The configured prompt when it is allowed, otherwise the bundled file in data/prompts/. */
export function resolvePromptPath(configured: string | undefined, fallback: string, cwd: string = process.cwd()): string {
  const allowed = configured ? allowedPromptPath(configured, cwd) : null;
  if (configured && !allowed) {
    console.warn(`[prompt] ignored a prompt setting outside data/prompts/ or not an existing .md file; using ${fallback}`);
  }
  return allowed || path.join(cwd, "data", "prompts", fallback);
}
