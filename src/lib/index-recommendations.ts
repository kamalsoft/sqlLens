import type { IndexRecommendation } from "@/lib/review-schema";

const MAX_RECOMMENDATIONS = 5;
const MAX_KEY_COLUMNS = 6;
const MAX_INCLUDE_COLUMNS = 10;

// One identifier part: plain or [bracketed] (no dots or "]" inside). A table
// has up to three parts.
const PART = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*|\[[^\].\r\n]{1,128}\])`;
const TABLE = new RegExp(String.raw`^${PART}(?:\.${PART}){0,2}$`);
const COLUMN = new RegExp(String.raw`^${PART}$`);

const bare = (part: string) =>
  part.startsWith("[") && part.endsWith("]") ? part.slice(1, -1).replace(/]]/g, "]") : part;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bracket = (part: string) => `[${bare(part).replace(/]/g, "]]")}]`;

/** Matches a name with optional brackets, as a whole word. */
function namePattern(name: string): string {
  return String.raw`\[?${escapeRegExp(name)}\]?(?![\w])`;
}

/** Names defined by WITH name AS ( ... ) or , name AS ( ... ). */
function cteNames(sql: string): Set<string> {
  const names = new Set<string>();
  for (const match of sql.matchAll(/(?:\bwith|,)\s*\[?([A-Za-z_]\w*)\]?\s*(?:\([^)]*\)\s*)?as\s*\(/gi)) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

/** True when the table is read or written as a real table (not an alias or CTE). */
function referencesTable(sql: string, table: string, ctes: Set<string>): boolean {
  const parts = table.split(".").map(bare);
  const last = parts[parts.length - 1];
  if (ctes.has(last.toLowerCase())) return false;
  // An unqualified name may appear schema-qualified in the SQL (dbo.Orders).
  const name =
    parts.length === 1
      ? String.raw`(?:${PART}\s*\.\s*){0,2}${namePattern(last)}`
      : parts.map(namePattern).join(String.raw`\s*\.\s*`);
  return new RegExp(String.raw`\b(?:from|join|update|into|merge)\s+${name}`, "i").test(sql);
}

const ALIAS_STOPWORDS = new Set([
  "where", "with", "on", "inner", "left", "right", "full", "cross", "outer", "join", "group",
  "order", "option", "set", "values", "select", "union", "using", "output", "having",
]);

/** The table's own qualifiers: its last name part plus any FROM/JOIN alias. */
function qualifiers(sql: string, table: string): string[] {
  const parts = table.split(".").map(bare);
  const last = parts[parts.length - 1];
  const name = String.raw`(?:${PART}\s*\.\s*){0,2}${namePattern(last)}`;
  const out = [last];
  const pattern = new RegExp(String.raw`\b(?:from|join|update|into|merge)\s+${name}\s+(?:as\s+)?\[?([A-Za-z_]\w*)\]?`, "gi");
  for (const match of sql.matchAll(pattern)) {
    if (!ALIAS_STOPWORDS.has(match[1].toLowerCase())) out.push(match[1]);
  }
  return out;
}

/**
 * True when the column belongs to the table: qualified with one of the table's
 * qualifiers (s.RegionID), or used unqualified without being defined as an
 * output alias (`AS TopRank`), which would make it a computed or CTE column.
 */
function belongsTo(sql: string, column: string, own: string[]): boolean {
  const col = namePattern(bare(column));
  const ownQualified = own.map((q) => String.raw`\[?${escapeRegExp(q)}\]?\s*\.\s*${col}`).join("|");
  if (new RegExp(String.raw`(?<![\w@#])(?:${ownQualified})`, "i").test(sql)) return true;
  const unqualified = new RegExp(String.raw`(?<!\.\s*)(?<![\w@#])${col}`, "i").test(sql);
  const definedAsAlias = new RegExp(String.raw`\bas\s+${col}`, "i").test(sql);
  return unqualified && !definedAsAlias;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function unique(columns: string[]): string[] {
  const seen = new Set<string>();
  return columns.filter((c) => {
    const key = bare(c).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Builds the DDL from validated identifiers; model-written SQL is never used. */
export function buildCreateIndex(table: string, keys: string[], includes: string[]): string {
  const tableParts = table.split(".");
  const name = `IX_${bare(tableParts[tableParts.length - 1])}_${keys.map(bare).join("_")}`.slice(0, 128);
  const include = includes.length > 0 ? ` INCLUDE (${includes.map(bracket).join(", ")})` : "";
  return `CREATE NONCLUSTERED INDEX ${bracket(name)} ON ${tableParts.map(bracket).join(".")} (${keys.map(bracket).join(", ")})${include};`;
}

/**
 * Keeps model-proposed indexes only for real tables (not aliases, CTEs, temp
 * tables or table variables) whose columns all appear in the submitted SQL,
 * and attaches a generated CREATE INDEX statement.
 */
export function verifyIndexRecommendations(
  items: IndexRecommendation[],
  sql: string,
): { kept: IndexRecommendation[]; removed: number } {
  sql = stripComments(sql);
  const ctes = cteNames(sql);
  const kept: IndexRecommendation[] = [];

  for (const item of items) {
    const table = item.table.trim();
    const keys = unique(item.keyColumns.map((c) => c.trim())).slice(0, MAX_KEY_COLUMNS);
    const keySet = new Set(keys.map((k) => bare(k).toLowerCase()));
    const includes = unique(item.includeColumns.map((c) => c.trim()))
      .filter((c) => !keySet.has(bare(c).toLowerCase()))
      .slice(0, MAX_INCLUDE_COLUMNS);
    const columns = [...keys, ...includes];

    const valid =
      kept.length < MAX_RECOMMENDATIONS &&
      TABLE.test(table) &&
      !/^[#@]/.test(table) &&
      keys.length > 0 &&
      referencesTable(sql, table, ctes) &&
      columns.every((c) => COLUMN.test(c) && belongsTo(sql, c, qualifiers(sql, table)));
    if (!valid) continue;

    kept.push({ ...item, table, keyColumns: keys, includeColumns: includes, createStatement: buildCreateIndex(table, keys, includes) });
  }

  return { kept, removed: items.length - kept.length };
}
