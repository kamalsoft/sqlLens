"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/components/api-client";
import { ReviewResultView } from "@/components/review/ReviewResultView";
import {
  DEFAULT_SCHEMA_VERSION,
  type ReviewV1,
  type ReviewV2,
  type SchemaVersion,
} from "@/lib/review-schema";

type Model = {
  id: string;
  name: string;
  directory?: string;
  compatible: boolean;
};

type ModelStatus = {
  id: string;
  loaded: boolean;
  loading: boolean;
  lastError: string | null;
};

type AuditItem = { id: string; type: string; createdAt: string };

type ReviewResponse = {
  id?: string;
  model?: string;
  schemaVersion?: SchemaVersion;
  promptPath?: string;
  result?: ReviewV1 | ReviewV2;
};

type ReviewOutput = { schemaVersion: SchemaVersion; result: ReviewV1 | ReviewV2 };

function failureMessage(status: number, error: string | null): string {
  if (status === 429) return `The reviewer is busy. ${error ?? "Wait for the current review to finish, then retry."}`;
  if (status === 504) return "The model timed out. Try a smaller input or a smaller model.";
  if (status === 502) return "The model's output could not be parsed as a valid review.";
  return error ?? "Stored procedure analysis failed";
}

export default function ReviewPage() {
  const api = useApi();
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<ReviewOutput | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<SchemaVersion>(DEFAULT_SCHEMA_VERSION);
  const [statuses, setStatuses] = useState<ModelStatus[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [executionAuditId, setExecutionAuditId] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ models?: Model[] }>(
      "/api/review/models",
      { cache: "no-store" },
      "Unable to load installed models"
    ).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        const installedModels = res.data?.models ?? [];
        setModels(installedModels);
        setModelId(installedModels[0]?.id ?? "");
      } else if (res.status !== 401) {
        setError(res.error ?? "Unable to load installed models");
      }
      setLoadingModels(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Optional extras: degrade silently if the endpoints are unavailable.
  useEffect(() => {
    let cancelled = false;
    void api<{ models?: ModelStatus[] }>("/api/models/status", { cache: "no-store" }).then((res) => {
      if (!cancelled && res.ok) setStatuses(res.data?.models ?? []);
    });
    void api<{ audits?: AuditItem[] }>("/api/audit", { cache: "no-store" }).then((res) => {
      if (!cancelled && res.ok) {
        setAudits((res.data?.audits ?? []).filter((audit) => audit.type === "EXECUTE"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function analyzeProcedure() {
    const procedure = sql.trim();

    if (!modelId) {
      setError("Select an installed model.");
      return;
    }

    if (!procedure) {
      setError("Paste a stored procedure before analyzing.");
      return;
    }

    setAnalyzing(true);
    setError("");
    setResult(null);
    setDetails("");

    const res = await api<ReviewResponse>(
      "/api/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          sql: procedure,
          schemaVersion,
          ...(executionAuditId ? { executionAuditId } : {}),
        }),
      },
      "Stored procedure analysis failed"
    );

    if (res.ok) {
      if (res.data?.result) {
        setResult({
          schemaVersion: res.data.schemaVersion ?? schemaVersion,
          result: res.data.result,
        });
      } else {
        setError("The selected model returned an empty result.");
      }
    } else if (res.status !== 401) {
      setError(failureMessage(res.status, res.error));
      const d = res.details as { responsePreview?: unknown } | null;
      if (res.status === 502 && d && typeof d.responsePreview === "string") {
        setDetails(d.responsePreview);
      }
    }
    setAnalyzing(false);
  }

  const selectedModel = models.find((model) => model.id === modelId);
  const selectedStatus = statuses.find((status) => status.id === modelId);
  const canAnalyze = Boolean(
    selectedModel?.compatible && sql.trim() && !analyzing
  );

  const compatibleModels = models.filter((model) => model.compatible);

  return (
    <main className="review-page">
      <header className="review-hero">
        <div>
          <span className="review-eyebrow">R001</span>
          <h1>Review Stored Procedure</h1>
          <p>
            Select an installed Hugging Face model and analyze a SQL Server
            stored procedure locally.
          </p>
        </div>
      </header>

      {error && (
        <div className="review-alert" role="alert">
          {error}
          {details && <pre aria-label="Response preview">{details}</pre>}
        </div>
      )}

      <section className="review-layout">
        <div className="review-panel">
          <div className="review-panel-heading">
            <div>
              <span className="review-step">01</span>
              <h2>Configure analysis</h2>
            </div>
            <span className="review-local-badge">Local model</span>
          </div>

          <label className="review-field">
            <span>Model</span>
            <select
              value={modelId}
              onChange={(event) => {
                setModelId(event.target.value);
                setError("");
              }}
              disabled={loadingModels || models.length === 0 || analyzing}
            >
              {loadingModels ? (
                <option value="">Loading installed models...</option>
              ) : models.length === 0 ? (
                <option value="">
                  No downloaded models found
                </option>
              ) : (
                compatibleModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))
              )}
            </select>

            {selectedModel && (
              <small className="review-field-help">
                {selectedModel.id}
              </small>
            )}
          </label>

          {selectedStatus && (
            <small className="review-field-help" data-testid="model-status">
              {selectedStatus.lastError
                ? `Model error: ${selectedStatus.lastError}`
                : selectedStatus.loading
                  ? "Model status: loading"
                  : selectedStatus.loaded
                    ? "Model status: loaded"
                    : "Model status: not loaded (loads on first review)"}
            </small>
          )}

          <label className="review-field">
            <span>Result schema</span>
            <select
              value={schemaVersion}
              onChange={(event) => setSchemaVersion(event.target.value as SchemaVersion)}
              disabled={analyzing}
            >
              <option value="v2">v2 (tables: findings, performance, security, testing)</option>
              <option value="v1">v1 (summary and issues)</option>
            </select>
          </label>

          {audits.length > 0 && (
            <label className="review-field">
              <span>Include telemetry from execution</span>
              <select
                value={executionAuditId}
                onChange={(event) => setExecutionAuditId(event.target.value)}
                disabled={analyzing}
              >
                <option value="">None</option>
                {audits.map((audit) => (
                  <option key={audit.id} value={audit.id}>
                    {new Date(audit.createdAt).toLocaleString()} ({audit.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="review-field">
            <span>Stored procedure</span>
            <textarea
              value={sql}
              onChange={(event) => {
                setSql(event.target.value);
                setError("");
              }}
              placeholder={`CREATE PROCEDURE dbo.GetOrders
  @CustomerId int
AS
BEGIN
  SELECT *
  FROM dbo.Orders
  WHERE CustomerId = @CustomerId;
END`}
              rows={20}
              spellCheck={false}
              disabled={analyzing}
            />
            <small className="review-field-help">
              {sql.length.toLocaleString()} characters
            </small>
          </label>

          <button
            type="button"
            className="review-analyze-button"
            onClick={() => void analyzeProcedure()}
            disabled={!canAnalyze}
          >
            {analyzing ? "Analyzing stored procedure..." : "Analyze SP"}
          </button>
        </div>

        <div className="review-panel review-results-panel">
          <div className="review-panel-heading">
            <div>
              <span className="review-step">02</span>
              <h2>Analysis results</h2>
            </div>
          </div>

          {analyzing ? (
            <div className="review-state" role="status">
              <div className="review-spinner" />
              <strong>Running local analysis</strong>
              <p>The selected model is processing your procedure.</p>
            </div>
          ) : result ? (
            <ReviewResultView schemaVersion={result.schemaVersion} result={result.result} />
          ) : (
            <div className="review-state">
              <div className="review-state-icon">✦</div>
              <strong>No analysis yet</strong>
              <p>
                Select a model, paste a stored procedure, and choose Analyze
                SP.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
