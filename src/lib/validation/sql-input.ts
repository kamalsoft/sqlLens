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

const IDENT = String.raw`[\w.\[\]"#@]+`;

// Per-statement shape checks, so English that happens to start with a SQL
// word ("Set the table…", "Select the best…") is not mistaken for SQL.
const STATEMENT_RULES: RegExp[] = [
  /^(create|alter)\s+(or\s+(alter|replace)\s+)?(proc|procedure|function|trigger|view|table|index|unique|clustered|nonclustered|schema|type|sequence|synonym|database|login|user|role)\b/i,
  /^select\s+(distinct\s+|top\s*\(?\d+\)?\s+)?[^a-z\s]/i,
  /^select\s[\s\S]*\bfrom\s/i,
  new RegExp(String.raw`^select\s+${IDENT}\s*(,|;|$|\bas\b|\bfrom\b|\binto\b)`, "i"),
  /^set\s+(@|nocount|ansi_\w+|quoted_identifier|xact_abort|transaction|statistics|arithabort|concat_null_yields_null|implicit_transactions|datefirst|dateformat|language|lock_timeout|rowcount|deadlock_priority|identity_insert|noexec|showplan_\w+|search_path|session|local|time\s+zone)\b/i,
  new RegExp(String.raw`^update\s+(top\s*\(\d+\)\s+)?${IDENT}\s+set\s`, "i"),
  new RegExp(String.raw`^insert\s+(into\s+)?${IDENT}\s*(\(|values\b|select\b|exec\b|default\s+values\b)`, "i"),
  new RegExp(String.raw`^delete\s+(top\s*\(\d+\)\s+)?(from\s+)?${IDENT}(\s+(where|from|output)\b|\s*;|\s*$)`, "i"),
  new RegExp(String.raw`^merge\s+(into\s+)?${IDENT}[\s\S]*\busing\b`, "i"),
  new RegExp(String.raw`^with\s+${IDENT}\s*(\([^)]*\)\s*)?as\s*\(`, "i"),
  new RegExp(String.raw`^exec(ute)?\s+(@\w+\s*=\s*)?(${IDENT}\.${IDENT}|sp_\w+|xp_\w+|\w+\s+@|\w+\s*;|\w+\s*$|\()`, "i"),
  /^declare\s+@\w+/i,
  /^(begin\s+(tran|transaction|try|distributed)\b|begin\s*$|begin\s*;)/i,
  /^(use\s+[\w\[\]]+\s*;?\s*(\n|$)|go\s*(\n|$))/i,
  new RegExp(String.raw`^(truncate\s+table|drop\s+(proc|procedure|function|table|view|index|trigger)\s+(if\s+exists\s+)?)${IDENT}`, "i"),
  new RegExp(String.raw`^call\s+${IDENT}\s*\(`, "i"),
  /^if\s+(not\s+)?(exists\s*\(|object_id\s*\(|@)/i,
];

export const NOT_SQL_ERROR =
  "This does not look like SQL. Paste a stored procedure or SQL statement (for example CREATE PROCEDURE … or SELECT …).";

/**
 * Lightweight heuristic: rejects prose, JSON, Markdown or other languages
 * pasted where a stored procedure or SQL statement is expected. It is not a
 * SQL parser; it never executes or rewrites the text.
 */
export function looksLikeSql(sql: string): boolean {
  const code = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/^\s*```[a-z]*\s*$/gim, " ")
    .trim();
  if (!code) return false;
  const first = code.replace(/^[\s;]+/, "");
  return STATEMENT_RULES.some((rule) => rule.test(first));
}
