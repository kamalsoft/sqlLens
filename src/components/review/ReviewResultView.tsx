import type { ReactNode } from "react";
import type { ReviewV1, ReviewV2, SchemaVersion } from "@/lib/review-schema";
import {
  type Recommendation,
  RecommendationGroups,
  recommendationsFromV1,
  recommendationsFromV2,
} from "./RecommendationGroups";

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <>
      <h3>{caption}</h3>
      {rows.length === 0 ? (
        <p>None reported.</p>
      ) : (
        <table aria-label={caption}>
          <thead>
            <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function ReviewResultView({
  schemaVersion,
  result,
  renderActions,
}: {
  schemaVersion: SchemaVersion;
  result: ReviewV1 | ReviewV2;
  renderActions?: (item: Recommendation) => ReactNode;
}) {
  if (schemaVersion === "v1") {
    const v1 = result as ReviewV1;
    return (
      <section aria-label="Review result v1">
        <h3>Summary</h3>
        <p>{v1.summary}</p>
        <h3>Recommendations</h3>
        <RecommendationGroups items={recommendationsFromV1(v1)} renderActions={renderActions} />
        <h3>Rewritten Procedure</h3>
        <pre>{v1.rewrittenProcedure}</pre>
        <p>Confidence: {v1.confidence}</p>
      </section>
    );
  }

  const v2 = result as ReviewV2;
  return (
    <section aria-label="Review result v2">
      <h3>Summary</h3>
      <p>{v2.summary}</p>
      <p>
        Overall risk: <strong>{v2.overallRisk}</strong> · Confidence: {v2.confidence}
      </p>
      <h3>Recommendations</h3>
      <RecommendationGroups items={recommendationsFromV2(v2)} renderActions={renderActions} />
      <Table
        caption="Findings"
        head={["Category", "Finding", "Evidence", "Severity", "Recommendation"]}
        rows={v2.findingsTable.map((r) => [r.category, r.finding, r.evidence, r.severity, r.recommendation])}
      />
      <Table
        caption="Performance"
        head={["Area", "Observation", "Evidence", "Impact", "Recommendation"]}
        rows={v2.performanceTable.map((r) => [r.area, r.observation, r.evidence, r.impact, r.recommendation])}
      />
      <Table
        caption="Security"
        head={["Area", "Observation", "Evidence", "Risk", "Recommendation"]}
        rows={v2.securityTable.map((r) => [r.area, r.observation, r.evidence, r.risk, r.recommendation])}
      />
      <Table
        caption="Testing"
        head={["Test", "Purpose", "Expected result"]}
        rows={v2.testingTable.map((r) => [r.test, r.purpose, r.expectedResult])}
      />
      <h3>Rewritten Procedure</h3>
      <pre>{v2.rewrittenProcedure}</pre>
      {v2.limitations.length > 0 && (
        <>
          <h3>Limitations</h3>
          <ul>{v2.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </>
      )}
    </section>
  );
}
