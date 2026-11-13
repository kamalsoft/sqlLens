import type { ReviewV2 } from "@/lib/review-schema";

const NOT_OBSERVED = "not observed";

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

// Fragments shorter than this ("(", ");") carry no evidence on their own, and
// an abbreviated quote must keep at least MIN_QUOTED characters in total.
const MIN_FRAGMENT = 4;
const MIN_QUOTED = 10;
const ELLIPSIS = /\.{3}|…/;

/**
 * Evidence is supported when it is quoted from the SQL. An abbreviated quote
 * ("BEGIN TRY...END TRY") is supported when every fragment appears in order.
 */
function supported(evidence: string, sql: string): boolean {
  const e = normalize(evidence);
  if (e === normalize(NOT_OBSERVED)) return true;
  if (e.length > 0 && sql.includes(e)) return true;

  if (!ELLIPSIS.test(evidence)) return false;
  const fragments = evidence
    .split(ELLIPSIS)
    .map((f) => normalize(f).replace(/^[(),;]+|[(),;]+$/g, ""))
    .filter((f) => f.length >= MIN_FRAGMENT);
  if (fragments.join("").length < MIN_QUOTED) return false;

  let from = 0;
  for (const fragment of fragments) {
    const at = sql.indexOf(fragment, from);
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}

/** Longest evidence shown; the check against the SQL uses the whole quote. */
export const MAX_EVIDENCE_CHARS = 300;

/** RJ-2: strips Markdown code fences a model wraps around a quote. */
function unfence(evidence: string): string {
  return evidence.replace(/^\s*```[\w-]*[^\S\n]*\n?/, "").replace(/\n?[^\S\n]*```\s*$/, "").trim();
}

/** RJ-2: long quotes (a model sometimes pastes the whole procedure) are cut, so a row stays readable. */
function shorten(evidence: string): string {
  return evidence.length > MAX_EVIDENCE_CHARS ? `${evidence.slice(0, MAX_EVIDENCE_CHARS).trimEnd()}…` : evidence;
}

/**
 * Drops v2 table rows whose evidence is not quoted from the submitted SQL.
 * Small models copy the prompt's example rows; this keeps them out of results.
 */
export function dropUnsupportedEvidence(review: ReviewV2, sqlText: string): ReviewV2 {
  const sql = normalize(sqlText);
  let removed = 0;
  const keep = <T extends { evidence: string }>(rows: T[]): T[] =>
    rows.flatMap((row) => {
      const evidence = unfence(row.evidence);
      if (supported(evidence, sql)) return [{ ...row, evidence: shorten(evidence) }];
      removed += 1;
      return [];
    });

  const result: ReviewV2 = {
    ...review,
    findingsTable: keep(review.findingsTable),
    performanceTable: keep(review.performanceTable),
    securityTable: keep(review.securityTable),
  };
  if (removed > 0) {
    result.limitations = [
      ...review.limitations,
      `${removed} item(s) removed because their evidence was not found in the submitted procedure.`,
    ];
  }
  return result;
}
