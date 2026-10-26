// Statements that change data or drop objects, followed by their target.
const WRITE_TARGET =
  /\b(?:insert\s+(?:into\s+)?|update\s+|delete\s+(?:top\s*\(\s*\d+\s*\)\s*)?(?:from\s+)?|merge\s+(?:into\s+)?|truncate\s+table\s+|drop\s+(?:table|view|procedure|proc|function)\s+(?:if\s+exists\s+)?)((?:\[[^\]\r\n]+\]|[#@]?[A-Za-z_][\w]*)(?:\s*\.\s*(?:\[[^\]\r\n]+\]|[A-Za-z_][\w]*)){0,2})/gi;

function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/N?'(?:[^']|'')*'/g, "''");
}

/** Lower-cased last name part of each permanent object the SQL writes to or drops. */
export function writeTargets(sql: string): Set<string> {
  const targets = new Set<string>();
  for (const match of stripCommentsAndStrings(sql).matchAll(WRITE_TARGET)) {
    const parts = match[1].split(".").map((p) => p.trim().replace(/^\[|\]$/g, ""));
    const name = parts[parts.length - 1].toLowerCase();
    if (!/^[#@]/.test(name) && name !== "statistics") targets.add(name);
  }
  return targets;
}

/**
 * Permanent tables (or views, procedures, functions) the rewrite writes to or
 * drops that the original never does. A rewrite must not change what data a
 * procedure modifies, so any result here means the rewrite is unsafe.
 */
export function newWriteTargets(original: string, rewrite: string): string[] {
  const before = writeTargets(original);
  return [...writeTargets(rewrite)].filter((name) => !before.has(name));
}

/** Variables declared as procedure parameters or with DECLARE (lower-cased). */
function declaredVariables(code: string): Set<string> {
  const declared = new Set<string>();
  const header = code.match(/\bcreate\s+(?:or\s+alter\s+)?proc(?:edure)?\s+[^\s(]+([\s\S]*?)\bas\b/i);
  const sources = [header?.[1] ?? "", ...[...code.matchAll(/\bdeclare\b([^;]*)/gi)].map((m) => m[1])];
  for (const source of sources) {
    for (const match of source.matchAll(/(@\w+)\s+(?:as\s+)?[A-Za-z]/g)) declared.add(match[1].toLowerCase());
  }
  return declared;
}

function createdTempTables(code: string): Set<string> {
  const created = new Set<string>();
  // CREATE TABLE #t, or SELECT ... INTO #t (but not INSERT INTO #t).
  for (const match of code.matchAll(/\b(?:create\s+table|(?<!\binsert\s+)into)\s+(#\w+)/gi)) {
    created.add(match[1].toLowerCase());
  }
  return created;
}

/**
 * Names the rewrite uses but never defines: @variables that are not
 * parameters or DECLAREd, and #temp tables the original creates but the
 * rewrite does not. Any result means the rewrite cannot run as written.
 */
export function missingDeclarations(original: string, rewrite: string): string[] {
  const code = stripCommentsAndStrings(rewrite);
  const declared = declaredVariables(code);
  const missing = new Set<string>();
  for (const match of code.matchAll(/(?<![@\w])@\w+/g)) {
    if (!declared.has(match[0].toLowerCase())) missing.add(match[0]);
  }

  const created = createdTempTables(code);
  const createdByOriginal = createdTempTables(stripCommentsAndStrings(original));
  for (const match of code.matchAll(/(?<![#\w])#\w+/g)) {
    const name = match[0].toLowerCase();
    if (createdByOriginal.has(name) && !created.has(name)) missing.add(match[0]);
  }
  return [...missing];
}

/** Lower-cased parameter names of a CREATE PROCEDURE header, in order. */
export function procedureParameters(sql: string): string[] {
  const header = stripCommentsAndStrings(sql).match(/\bcreate\s+(?:or\s+alter\s+)?proc(?:edure)?\s+[^\s(]+([\s\S]*?)\bas\b/i);
  return [...(header?.[1] ?? "").matchAll(/(@\w+)\s+(?:as\s+)?[A-Za-z]/g)].map((m) => m[1].toLowerCase());
}
