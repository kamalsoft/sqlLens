import { readFile } from "node:fs/promises";
import path from "node:path";

export const SMALL_MODEL_PARAMETERS = 1_000_000_000;

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Rough decoder-only parameter count from a Hugging Face config.json:
 * layers * (4*h^2 + 3*h*intermediate) + vocab*h. Returns null when a field is missing.
 */
export function estimateParameters(config: unknown): number | null {
  if (typeof config !== "object" || config === null) return null;
  const c = config as Record<string, unknown>;
  const layers = positive(c.num_hidden_layers);
  const h = positive(c.hidden_size);
  const inter = positive(c.intermediate_size);
  const vocab = positive(c.vocab_size);
  if (!layers || !h || !inter || !vocab) return null;
  return Math.round(layers * (4 * h * h + 3 * h * inter) + vocab * h);
}

/** Small means a known estimate under 1B. Unknown is not small. */
export function isSmallModel(parameterEstimate: number | null): boolean {
  return parameterEstimate !== null && parameterEstimate < SMALL_MODEL_PARAMETERS;
}

export async function readParameterEstimate(modelDirectory: string): Promise<number | null> {
  try {
    return estimateParameters(JSON.parse(await readFile(path.join(modelDirectory, "config.json"), "utf8")));
  } catch {
    return null;
  }
}
