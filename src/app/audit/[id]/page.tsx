"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/components/api-client";
import { ReviewResultView } from "@/components/review/ReviewResultView";
import type { ReviewV1, ReviewV2, SchemaVersion } from "@/lib/review-schema";
import {
  FeedbackControls,
  type FeedbackEntry,
  type FeedbackStatus,
} from "@/components/audit/FeedbackControls";
import { SharePanel } from "@/components/audit/SharePanel";
import { MetricComparisonTable, fmt, type MetricsMap } from "@/components/audit/MetricComparisonTable";

type AuditRecord = {
  id: string;
  type: string;
  createdAt: string;
  request: unknown;
  response: unknown;
  engine: string | null;
  simulated: boolean;
  status: string;
  recordNumber: number | null;
  schemaVersion: string | null;
  modelId: string | null;
  feedback: Record<string, FeedbackEntry>;
};

// Loose view of stored execution results; tolerant of missing fields.
type ExecAnalysis = {
  performanceGrade?: string | null;
  summary?: string;
  ioAnalysis?: {
    totalLogicalReads?: number | null;
    totalPhysicalReads?: number | null;
    totalScanCount?: number | null;
  };
  timeAnalysis?: { totalMs?: number | null };
  metrics?: MetricsMap;
};
type ExecResponse = {
  mode?: "single" | "compare";
  analysis?: ExecAnalysis;
  comparison?: ExecAnalysis & { comparisonSummary?: string };
  metrics?: MetricsMap;
};
type CompareResponse = { summary?: string; verdict?: string; recommendations?: string[]; bottlenecks?: string[] };

function ExecutionView({ response }: { response: ExecResponse }) {
  if (response.mode === "compare") {
    const metrics = response.comparison?.metrics ?? response.metrics;
    return (
      <section aria-label="Execution comparison">
        {response.comparison?.comparisonSummary && <p>{response.comparison.comparisonSummary}</p>}
        <MetricComparisonTable metrics={metrics} />
      </section>
    );
  }
  const a = response.analysis;
  return (
    <section aria-label="Execution metrics">
      {a?.summary && <p>{a.summary}</p>}
      <dl>
        <dt>Grade</dt>
        <dd>{a?.performanceGrade ?? "not captured"}</dd>
        <dt>Logical reads</dt>
        <dd>{fmt(a?.ioAnalysis?.totalLogicalReads)}</dd>
        <dt>Physical reads</dt>
        <dd>{fmt(a?.ioAnalysis?.totalPhysicalReads)}</dd>
        <dt>Scan count</dt>
        <dd>{fmt(a?.ioAnalysis?.totalScanCount)}</dd>
        <dt>Total time</dt>
        <dd>{fmt(a?.timeAnalysis?.totalMs, " ms")}</dd>
      </dl>
    </section>
  );
}

export default function AuditDetailPage() {
  const api = useApi();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const [feedback, setFeedback] = useState<Record<string, FeedbackEntry>>({});
  const [loadError, setLoadError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api<AuditRecord>(`/api/audit/${encodeURIComponent(id)}`, { cache: "no-store" }, "Unable to load record").then(
      (res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setRecord(res.data);
          setFeedback(res.data.feedback ?? {});
        } else if (res.status !== 401) {
          setLoadError(res.status === 404 ? "Audit record not found" : (res.error ?? "Unable to load record"));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  async function changeFeedback(key: string, status: FeedbackStatus, note: string) {
    const previous = feedback[key];
    setFeedbackError("");
    setFeedback((current) => ({ ...current, [key]: { status, note, updatedAt: previous?.updatedAt } }));

    const res = await api(
      `/api/audit/${encodeURIComponent(id)}/recommendations`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ key, status, note }] }),
      },
      "Unable to save feedback"
    );

    if (!res.ok) {
      setFeedback((current) => {
        const next = { ...current };
        if (previous) next[key] = previous;
        else delete next[key];
        return next;
      });
      if (res.status !== 401) setFeedbackError(res.error ?? "Unable to save feedback");
    }
  }

  if (loadError) return <div role="alert">{loadError}</div>;
  if (!record) return <p role="status">Loading record...</p>;

  const response = record.response as Record<string, unknown> | null;

  return (
    <main>
      <p>
        <Link href="/audit">Back to audit history</Link>
      </p>
      <header className="page-header">
        <div>
          <p className="page-kicker">Record #{record.recordNumber ?? "-"}</p>
          <h2 className="page-title">{record.type}</h2>
          <p>
            {new Date(record.createdAt).toLocaleString()}
            {record.engine ? ` · ${record.engine}` : ""}
            {record.modelId ? ` · ${record.modelId}` : ""}{" "}
            {record.simulated && <span className="badge">Simulated</span>}
          </p>
        </div>
        <SharePanel auditId={record.id} />
      </header>

      {feedbackError && <div role="alert">{feedbackError}</div>}

      {record.type === "REVIEW" && response?.result ? (
        <ReviewResultView
          schemaVersion={(record.schemaVersion === "v1" ? "v1" : "v2") as SchemaVersion}
          result={response.result as ReviewV1 | ReviewV2}
          renderActions={(item) =>
            item.key ? (
              <FeedbackControls
                itemKey={item.key}
                entry={feedback[item.key]}
                onChange={(key, status, note) => void changeFeedback(key, status, note)}
              />
            ) : null
          }
        />
      ) : record.type === "EXECUTE" || record.type === "EXECUTE_COMPARE" ? (
        <ExecutionView response={(response ?? {}) as ExecResponse} />
      ) : record.type === "COMPARE" ? (
        <section aria-label="Comparison summary">
          <h3>Summary</h3>
          <p>{(response as CompareResponse | null)?.summary ?? "No summary stored."}</p>
          {(response as CompareResponse | null)?.verdict && (
            <p>Verdict: {(response as CompareResponse).verdict}</p>
          )}
          <ul>
            {((response as CompareResponse | null)?.recommendations ?? []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p>This record has no displayable result.</p>
      )}
    </main>
  );
}
