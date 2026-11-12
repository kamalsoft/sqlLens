const SENSITIVE_KEY = /pass(word)?|pwd|token|secret|authorization|cookie|hf_token|api[-_]?key|credential|private[-_]?key|connection/i;
const MAX_DEPTH = 8;
const MAX_MESSAGE = 500;

/**
 * SEC-T8: scrubs text before it is logged. Driver and runtime messages can carry connection-string secrets,
 * tokens, quoted SQL or names ('dbo.Payroll', 'sa'), and server addresses (db01:1433).
 */
export function scrubText(text: string): string {
  const scrubbed = text
    // Credentials in a URL: scheme://user:pass@host
    .replace(/\b([a-z][\w+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    // key=value secrets, including quoted values with spaces
    .replace(/\b(password|pwd|user id|uid|access[ _]?token|token|secret|api[_-]?key)\s*=\s*("[^"]*"|'[^']*'|[^;\s]*)/gi, "$1=[REDACTED]")
    // JSON secrets: "password": "x"
    .replace(/"(password|pwd|secret|token|access_?token|api[_-]?key)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
    .replace(/\bhf_[A-Za-z0-9]{8,}/g, "hf_[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    // Quoted names and SQL, single or double quotes (redacted values and JSON keys are left alone)
    .replace(/'(?!\[)[^'\n]{1,500}'/g, "'[…]'")
    .replace(/"(?!\[)(?!(?:password|pwd|secret|token|access_?token|api[_-]?key)")[^"\n]{1,500}"/gi, '"[…]"')
    .replace(/\b[\w.-]+:\d{2,5}\b/g, "[host]:[port]");
  return scrubbed.length > MAX_MESSAGE ? `${scrubbed.slice(0, MAX_MESSAGE)}…` : scrubbed;
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message) };
  }
  if (typeof value === "string") return scrubText(value);
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
