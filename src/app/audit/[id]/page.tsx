"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/components/api-client";
import { ReviewResultView } from "@/components/review/ReviewResultView";
import type { ReviewV1, ReviewV2, SchemaVersion } from "@/lib/review-schema";
import type { RefactorResult } from "@/lib/refactor-shared";
import {
  FeedbackControls,
  type FeedbackEntry,
  type FeedbackStatus,
} from "@/components/audit/FeedbackControls";
import { SharePanel } from "@/components/audit/SharePanel";
import { MetricComparisonTable, fmt, type MetricsMap } from "@/components/audit/MetricComparisonTable";
import { CopyButton } from "@/components/refactor/RefactorResultView";

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
  related?: {
    source: { id: string; recordNumber: number | null } | null;
    refactors: { id: string; recordNumber: number | null }[];
  };
};

const TYPE_LABEL: Record<string, string> = {
  EXECUTE: "Execution",
  EXECUTE_COMPARE: "Execution comparison",
  REVIEW: "Review",
  COMPARE: "Comparison",
  REFACTOR: "Refactor",
};

/** AD-1: what the model was given; stored on records made since prompts were saved. */
type StoredPrompt = { template?: string; text?: string; message?: string };

/** A titled block on the record page; `open` decides whether a collapsible one starts expanded. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel panel-card settings-group" aria-label={title}>
      <h3 className="section-title">{title}</h3>
      <div className="record-block">{children}</div>
    </section>
  );
}

/** Raw stored JSON, folded away with a copy button. */
function RawJson({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return (
    <details className="connect-more">
      <summary>Show the stored {label.toLowerCase()}</summary>
      <div className="review-code-header">
        <span>{text.length.toLocaleString()} characters</span>
        <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre className="review-code" aria-label={`Stored ${label.toLowerCase()}`}>{text}</pre>
    </details>
  );
}

// Loose view of stored execution results; tolerant of missing fields.
type ExecAnalysis = {
  performanceGrade?: string | null;
  summary?: string;
  prodVerdict?: { verdict: string; reason: string; driver: string | null };
  planOperators?: { physicalOp: string; table: string | null; logicalReads: number | null; actualRows: number | null; executions: number | null }[];
  ioAnalysis?: {
    totalLogicalReads?: number | null;
    totalPhysicalReads?: number | null;
    totalScanCount?: number | null;
    rowCounts?: Record<string, number> | null;
  };
  timeAnalysis?: { totalMs?: number | null };
  metrics?: MetricsMap;
};
type ExecResponse = {
  mode?: "single" | "compare";
  execution?: { outputs?: Record<string, unknown> };
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
        <dt>Prod readiness</dt>
        <dd>{a?.prodVerdict ? `${a.prodVerdict.verdict}: ${a.prodVerdict.reason}` : "not stored"}</dd>
        <dt>Costliest operators</dt>
        <dd>
          <ul>
            {(a?.planOperators ?? []).map((op, i) => (
              <li key={i}>{op.physicalOp}{op.table ? ` on ${op.table}` : ""}: {fmt(op.logicalReads, " logical reads")}</li>
            ))}
          </ul>
        </dd>
        {a?.ioAnalysis?.rowCounts && Object.entries(a.ioAnalysis.rowCounts).map(([table, rows]) => (
          <span key={table} style={{ display: "contents" }}>
            <dt>Rows in {table}</dt>
            <dd>{Number(rows).toLocaleString()}</dd>
          </span>
        ))}
      </dl>
      {response.execution?.outputs && Object.keys(response.execution.outputs).length > 0 && (
        <pre aria-label="OUTPUT parameters">{JSON.stringify(response.execution.outputs, null, 2)}</pre>
      )}
    </section>
  );
}

export default function AuditDetailPage() {
  const api = useApi();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const router = useRouter();
  // SEC-T4: deleting asks once more, inline, before the record is gone for good.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function deleteRecord(id: string) {
    const res = await api<{ deleted?: boolean }>(`/api/audit/${encodeURIComponent(id)}`, { method: "DELETE" }, "Unable to delete the record");
    if (res.ok) router.push("/audit");
    else if (res.status !== 401) setDeleteError(res.error ?? "Unable to delete the record");
  }
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
  const request = (record.request ?? {}) as Record<string, unknown>;
  const prompt = request.prompt as StoredPrompt | undefined;
  const usesModel = record.type === "REVIEW" || record.type === "COMPARE" || record.type === "REFACTOR";
  const refactor = record.type === "REFACTOR" ? (response as RefactorResult | null) : null;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Audit record #{record.recordNumber ?? "-"}</p>
          <h2 className="page-title">{TYPE_LABEL[record.type] ?? record.type}</h2>
          <p className="analysis-note">Created {new Date(record.createdAt).toLocaleString()}</p>
        </div>
        <div className="page-actions">
          <Link href="/audit" className="button button-secondary">Back to Audit</Link>
          {/* Reopens the run on Execute & Audit SP with its saved result and refactor (a refactor opens its run). */}
          {(record.type === "EXECUTE" || record.type === "EXECUTE_COMPARE") && (
            <Link href={`/execute?record=${record.id}`} className="button button-primary">Open in Execute &amp; Audit SP</Link>
          )}
          {record.type === "REFACTOR" && record.related?.source && (
            <Link href={`/execute?record=${record.related.source.id}`} className="button button-primary">Open in Execute &amp; Audit SP</Link>
          )}
          <SharePanel auditId={record.id} />
          {confirmDelete ? (
            <span role="group" aria-label="Confirm delete" className="page-actions">
              <span>Delete this record permanently?</span>
              <button type="button" className="button button-danger" onClick={() => void deleteRecord(record.id)}>Delete</button>
              <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(true)}>Delete record</button>
          )}
        </div>
        {deleteError && <div role="alert" className="alert">{deleteError}</div>}
      </header>

      {feedbackError && <div role="alert" className="alert">{feedbackError}</div>}

      <Block title="Record">
        <dl className="record-facts">
          <dt>Type</dt><dd>{TYPE_LABEL[record.type] ?? record.type}</dd>
          <dt>Record</dt><dd>#{record.recordNumber ?? "-"}</dd>
          <dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString()}</dd>
          <dt>Engine</dt><dd>{record.engine ?? "-"}</dd>
          <dt>Model used</dt><dd>{record.modelId ?? (usesModel ? "not recorded" : "none: no model is used for this record")}</dd>
          <dt>Status</dt><dd>{record.status}</dd>
          <dt>Simulated run</dt><dd>{record.simulated ? <span className="badge">Simulated</span> : "No"}</dd>
        </dl>
      </Block>

      <Block title="Report">
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
            <p>{(response as CompareResponse | null)?.summary ?? "No summary stored."}</p>
            {(response as CompareResponse | null)?.verdict && <p>Verdict: {(response as CompareResponse).verdict}</p>}
            <ul>
              {((response as CompareResponse | null)?.recommendations ?? []).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </section>
        ) : refactor ? (
          <section aria-label="Refactor result">
            <p>{refactor.summary}</p>
            <dl className="record-facts">
              <dt>Status</dt><dd>{refactor.status}{refactor.statusDetail ? ` (${refactor.statusDetail})` : ""}</dd>
              <dt>Index recommendations</dt><dd>{refactor.indexRecommendations?.length ?? 0}</dd>
              <dt>View recommendations</dt><dd>{refactor.viewRecommendations?.length ?? 0}</dd>
              <dt>Other recommendations</dt><dd>{refactor.otherRecommendations?.length ?? 0}</dd>
              <dt>Changes</dt><dd>{refactor.changes?.length ?? 0}</dd>
            </dl>
            {refactor.refactoredSql && (
              <>
                <div className="review-code-header">
                  <span>Refactored SQL (never executed)</span>
                  <CopyButton text={refactor.refactoredSql} label="Copy refactored SQL" />
                </div>
                <pre className="review-code">{refactor.refactoredSql}</pre>
              </>
            )}
          </section>
        ) : (
          <p className="analysis-note">This record has no displayable result.</p>
        )}
      </Block>

      {(record.related?.source || (record.related?.refactors.length ?? 0) > 0) && (
        <Block title="Related records">
          <ul className="record-links">
            {record.related?.source && (
              <li>
                Refactored from run{" "}
                <Link href={`/audit/${record.related.source.id}`} className="text-link">#{record.related.source.recordNumber ?? "-"}</Link>
              </li>
            )}
            {record.related?.refactors.map((r) => (
              <li key={r.id}>
                Refactored in <Link href={`/audit/${r.id}`} className="text-link">#{r.recordNumber ?? "-"}</Link>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Prompt">
        {!usesModel ? (
          <p className="analysis-note">No prompt: this record is a SQL execution, which does not use a model.</p>
        ) : !prompt?.text ? (
          <p className="analysis-note">Not recorded: this record was made before prompts were saved with audit records.</p>
        ) : (
          <>
            <dl className="record-facts">
              <dt>Template</dt><dd><code>{prompt.template ?? "-"}</code></dd>
              <dt>Final instruction</dt><dd>{prompt.message ?? "-"}</dd>
            </dl>
            <details className="connect-more">
              <summary>Show the full prompt sent to the model</summary>
              <div className="review-code-header">
                <span>{prompt.text.length.toLocaleString()} characters</span>
                <CopyButton text={prompt.text} label="Copy prompt" />
              </div>
              <pre className="review-code review-code-tall" aria-label="Prompt text">{prompt.text}</pre>
            </details>
          </>
        )}
      </Block>

      <Block title="Request">
        <RawJson label="Request" value={record.request} />
      </Block>

      <Block title="Response">
        <RawJson label="Response" value={record.response} />
      </Block>
    </>
  );
}
