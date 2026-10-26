import { format } from "sql-formatter";

const INDENT = "    ";

// Session options that belong on the same line as SET.
const SET_OPTION =
  /^([ \t]*)SET\n[ \t]*(?=(?:NOCOUNT|XACT_ABORT|ANSI_\w+|QUOTED_IDENTIFIER|TRANSACTION|STATISTICS|ARITHABORT|DEADLOCK_PRIORITY|LOCK_TIMEOUT|ROWCOUNT|DATEFIRST|DATEFORMAT|LANGUAGE|IMPLICIT_TRANSACTIONS|CONCAT_NULL_YIELDS_NULL|NOEXEC|@)\b|@)/gim;
// Table hints such as WITH (NOLOCK) stay on the table's line.
const TABLE_HINT = /\n[ \t]*WITH\n[ \t]*\(((?:[A-Z_]+(?:\s*\([^()]*\))?)(?:\s*,\s*[A-Z_]+(?:\s*\([^()]*\))?)*)\)/g;
// Procedural keywords that start their own line.
const CONTROL =
  /\s+(?=\b(?:BEGIN\s+TRY|END\s+TRY|BEGIN\s+CATCH|END\s+CATCH|BEGIN\s+TRAN(?:SACTION)?|COMMIT(?:\s+TRAN(?:SACTION)?)?|ROLLBACK(?:\s+TRAN(?:SACTION)?)?|BEGIN|END|ELSE)\b)/g;
const AFTER_CONTROL = /\b(BEGIN\s+TRY|BEGIN\s+CATCH|END\s+TRY|END\s+CATCH|BEGIN(?!\s+(?:TRAN|TRANSACTION|DISTRIBUTED)\b)|ELSE|END(?=\s+(?:DECLARE|SET|SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|IF|WHILE|RETURN|THROW|RAISERROR|PRINT|BEGIN|COMMIT|ROLLBACK|WITH|DROP|CREATE|TRUNCATE)\b))\s+(?=\S)/g;

/** Replaces string literals and comments with placeholders so layout never touches them. */
function mask(sql: string): { text: string; restore: (text: string) => string } {
  const saved: string[] = [];
  const text = sql.replace(/N?'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) => {
    saved.push(match);
    return `\u0000${saved.length - 1}\u0000`;
  });
  return { text, restore: (value) => value.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => saved[Number(i)]) };
}

/**
 * Tokens with whitespace removed and keyword case ignored (strings kept
 * exactly); repeated semicolons are equivalent. Formatting must not change it.
 */
function signature(sql: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const match of sql.matchAll(/N?'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g)) {
    parts.push(sql.slice(last, match.index).replace(/\s+/g, "").toUpperCase());
    parts.push(match[0].startsWith("--") || match[0].startsWith("/*") ? match[0].trim() : match[0]);
    last = (match.index ?? 0) + match[0].length;
  }
  parts.push(sql.slice(last).replace(/\s+/g, "").toUpperCase());
  return parts.join("").replace(/;+/g, ";");
}

/** Block-structures procedural T-SQL that sql-formatter lays out flat. */
function layout(formatted: string): string {
  const { text, restore } = mask(formatted);
  let body = text
    .replace(SET_OPTION, "$1SET ")
    .replace(TABLE_HINT, " WITH ($1)")
    .replace(/\b(CREATE(?:\s+UNIQUE)?(?:\s+(?:NON)?CLUSTERED)?)\n[ \t]*INDEX\b/g, "$1 INDEX")
    .replace(/\b(CREATE(?:\s+OR\s+ALTER)?\s+PROC(?:EDURE)?\s+\S+)[ \t]+@/gi, "$1\n@")
    .replace(/[ \t]+AS[ \t]+BEGIN\b/g, "\nAS\nBEGIN")
    .replace(/^[ \t]*;[ \t]*$/gm, "");

  // One procedural keyword per line, except inside CASE ... END expressions
  // (which sql-formatter spreads over several lines).
  let openCase = 0;
  body = body
    .split("\n")
    .map((line) => {
      const inCase = openCase > 0 || /\bCASE\b/.test(line);
      if (inCase) {
        const opens = (line.match(/\bCASE\b/g) ?? []).length;
        const ends = (line.match(/\bEND\b/g) ?? []).length;
        openCase = Math.max(0, openCase + opens - ends);
        return line;
      }
      return line.replace(CONTROL, "\n").replace(AFTER_CONTROL, "$1\n");
    })
    .join("\n");

  let depth = 0;
  let caseDepth = 0;
  let inHeader = /^\s*CREATE(?:\s+OR\s+ALTER)?\s+PROC/i.test(body);
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== "" && !/\b(BEGIN(\s+TRY|\s+CATCH)?|ELSE)$/.test(out[out.length - 1])) out.push("");
      continue;
    }
    caseDepth += (trimmed.match(/\bCASE\b/g) ?? []).length;
    const closesBlock = /^END(\s+TRY|\s+CATCH)?\b/.test(trimmed) && caseDepth === 0;
    if (/^END\b/.test(trimmed) && caseDepth > 0) caseDepth -= 1;
    if (closesBlock) {
      depth = Math.max(0, depth - 1);
      if (out[out.length - 1] === "") out.pop();
    }

    if (inHeader && trimmed === "AS") inHeader = false;
    const extra = inHeader && trimmed.startsWith("@") ? INDENT : "";
    out.push(INDENT.repeat(depth) + extra + line);

    if (/^BEGIN(\s+TRY|\s+CATCH)?$/.test(trimmed)) depth += 1;
  }
  return restore(
    out
      .join("\n")
      // Consecutive one-line DECLARE / SET statements read better without gaps.
      .replace(/^([ \t]*(?:DECLARE|SET)\b[^\n]*;)\n\n(?=[ \t]*(?:DECLARE|SET)\b)/gm, "$1\n")
      .replace(/^([ \t]*(?:DECLARE|SET)\b[^\n]*;)\n\n(?=[ \t]*(?:DECLARE|SET)\b)/gm, "$1\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/**
 * Formats T-SQL for display: sql-formatter for statements, plus block layout
 * for procedures. Batches are split on GO. If formatting fails, or would change
 * anything but whitespace and keyword case, the input is returned unchanged.
 */
export function formatTsql(sql: string): { text: string; formatted: boolean } {
  const source = sql.replace(/\r\n/g, "\n").trim();
  if (!source) return { text: "", formatted: false };
  const go = /^[ \t]*GO[ \t]*;?[ \t]*$/gim;
  try {
    const batches = source.split(go).map((b) => b.trim()).filter(Boolean);
    const endsWithGo = /(^|\n)[ \t]*GO[ \t]*;?[ \t]*$/i.test(source);
    const text =
      batches
        .map((batch) => layout(format(batch, { language: "transactsql", keywordCase: "upper", tabWidth: 4, linesBetweenQueries: 1 })))
        .join("\nGO\n\n") + (endsWithGo ? "\nGO" : "");
    const same = signature(text.replace(go, "")) === signature(source.replace(go, ""));
    return same ? { text, formatted: true } : { text: source, formatted: false };
  } catch {
    return { text: source, formatted: false };
  }
}
