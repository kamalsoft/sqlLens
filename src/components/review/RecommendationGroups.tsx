import type { ReactNode } from "react";
import type { ReviewV1, ReviewV2 } from "@/lib/review-schema";

export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
export const UNCATEGORIZED = "uncategorized";

export type Recommendation = {
  /** Feedback key, e.g. `findingsTable:0` (v2) or `issues:0` (v1). */
  key?: string;
  severity: (typeof SEVERITY_ORDER)[number];
  category: string;
  title: string;
  recommendation: string;
};

export type RecommendationGroup = {
  severity: (typeof SEVERITY_ORDER)[number];
  categories: Array<{ category: string; items: Recommendation[] }>;
};

export function recommendationsFromV1(result: ReviewV1): Recommendation[] {
  return result.issues.map((issue, index) => ({
    key: `issues:${index}`,
    severity: issue.severity,
    category: UNCATEGORIZED,
    title: issue.title,
    recommendation: issue.recommendation,
  }));
}

export function recommendationsFromV2(result: ReviewV2): Recommendation[] {
  return result.findingsTable.map((row, index) => ({
    key: `findingsTable:${index}`,
    severity: row.severity,
    category: row.category,
    title: row.finding,
    recommendation: row.recommendation,
  }));
}

/** Severity (critical -> low), then category (alphabetical, uncategorized last). */
export function groupRecommendations(items: Recommendation[]): RecommendationGroup[] {
  const groups: RecommendationGroup[] = [];
  for (const severity of SEVERITY_ORDER) {
    const inSeverity = items.filter((item) => item.severity === severity);
    if (inSeverity.length === 0) continue;
    const names = Array.from(new Set(inSeverity.map((item) => item.category))).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
    groups.push({
      severity,
      categories: names.map((category) => ({
        category,
        items: inSeverity.filter((item) => item.category === category),
      })),
    });
  }
  return groups;
}

export function RecommendationGroups({
  items,
  renderActions,
}: {
  items: Recommendation[];
  renderActions?: (item: Recommendation) => ReactNode;
}) {
  const groups = groupRecommendations(items);
  if (groups.length === 0) return <p>No recommendations.</p>;

  return (
    <div data-testid="recommendation-groups">
      {groups.map((group) => (
        <section key={group.severity} aria-label={`${group.severity} recommendations`}>
          <h4 data-testid="severity-heading">{group.severity.toUpperCase()}</h4>
          {group.categories.map(({ category, items: rows }) => (
            <div key={category}>
              <h5 data-testid="category-heading">{category.replace(/_/g, " ")}</h5>
              <ul>
                {rows.map((row, index) => (
                  <li key={`${row.title}-${index}`}>
                    <strong>{row.title}</strong>
                    <p>{row.recommendation}</p>
                    {renderActions?.(row)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
