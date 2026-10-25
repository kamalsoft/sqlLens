const SENSITIVE_KEY = /pass(word)?|pwd|token|secret|authorization|cookie|hf_token|api[-_]?key|credential|private[-_]?key|connection/i;
const MAX_DEPTH = 8;

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_DEPTH || seen.has(value)) return "[Truncated]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactInner(v, depth + 1, seen);
  }
  return out;
}

export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

export function logError(context: string, error: unknown): void {
  console.error(context, redact(error));
}
