export function validateSqlInput(
  value: unknown,
  maxLength: number
): { ok: true; sql: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "SQL must be a string" };
  if (value.includes("\0")) return { ok: false, error: "SQL contains invalid characters" };
  if (value.trim().length === 0) return { ok: false, error: "SQL is required" };
  if (value.length > maxLength) {
    return { ok: false, error: `SQL exceeds the maximum length of ${maxLength} characters` };
  }
  return { ok: true, sql: value };
}
