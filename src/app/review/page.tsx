"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/components/api-client";
import { ReviewResultView } from "@/components/review/ReviewResultView";
import { NOT_SQL_ERROR, looksLikeSql } from "@/lib/validation/sql-input";
import {
  type ReviewV1,
  type ReviewV2,
  type SchemaVersion,
} from "@/lib/review-schema";

type Model = {
  id: string;
  name: string;
  directory?: string;
  compatible: boolean;
  parameterEstimate?: number | null;
  small?: boolean;
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
  lowConfidence?: boolean;
  schemaFallback?: boolean;
  promptPath?: string;
  result?: ReviewV1 | ReviewV2;
};

type ReviewOutput = {
  schemaVersion: SchemaVersion;
  result: ReviewV1 | ReviewV2;
  lowConfidence: boolean;
  schemaFallback: boolean;
};

/** Strips Markdown code fences and pretty-prints the JSON part when it parses. */
function formatRawOutput(text: string): string {
  const unfenced = text.replace(/^\s*```[a-z]*\s*$/gim, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return unfenced;
  try {
    const pretty = JSON.stringify(JSON.parse(unfenced.slice(start, end + 1)), null, 2);
    return [unfenced.slice(0, start).trim(), pretty, unfenced.slice(end + 1).trim()]
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return unfenced;
  }
}

function sizeLabel(model: Model): string | null {
  if (typeof model.parameterEstimate !== "number") return null;
  const b = model.parameterEstimate / 1e9;
  const size = `~${Number(b.toFixed(b < 10 ? 1 : 0))}B parameters`;
  return model.small ? `${size} — small model; Auto uses v1` : `${size}; Auto uses v2`;
}

function failureMessage(status: number, error: string | null): string {
  if (status === 429) return `The reviewer is busy. ${error ?? "Wait for the current review to finish, then retry."}`;
  if (status === 504) return "The model timed out. Try a smaller input or a smaller model.";
  if (status === 502) {
    const generic = "The model's output could not be parsed as a valid review.";
    return error && error !== "Unable to parse model response" ? `${generic} ${error}` : generic;
  }
  return error ?? "Stored procedure analysis failed";
}

export default function ReviewPage() {
  const api = useApi();
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<ReviewOutput | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<SchemaVersion | "auto">("auto");
  const [statuses, setStatuses] = useState<ModelStatus[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [executionAuditId, setExecutionAuditId] = useState("");
  const [rawOutput, setRawOutput] = useState<{ text: string; validation: string } | null>(null);
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

    if (!looksLikeSql(procedure)) {
      setError(NOT_SQL_ERROR);
      return;
    }

    setAnalyzing(true);
    setError("");
    setResult(null);
    setRawOutput(null);

    const res = await api<ReviewResponse>(
      "/api/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          sql: procedure,
          ...(schemaVersion === "auto" ? {} : { schemaVersion }),
          ...(executionAuditId ? { executionAuditId } : {}),
        }),
      },
      "Stored procedure analysis failed"
    );

    if (res.ok) {
      if (res.data?.result) {
        setResult({
          schemaVersion: res.data.schemaVersion ?? (schemaVersion === "auto" ? "v2" : schemaVersion),
          lowConfidence: res.data.lowConfidence === true,
          schemaFallback: res.data.schemaFallback === true,
          result: res.data.result,
        });
      } else {
        setError("The selected model returned an empty result.");
      }
    } else if (res.status !== 401) {
      setError(failureMessage(res.status, res.error));
      const d = res.details as
        | {
            message?: unknown;
            responseText?: unknown;
            responsePreview?: unknown;
            responseTail?: unknown;
            responseCharacters?: unknown;
          }
        | null;
      if (res.status === 502 && d && typeof d.responsePreview === "string") {
        let text: string;
        if (typeof d.responseText === "string") {
          text = d.responseText;
        } else {
          const parts = [d.responsePreview];
          if (typeof d.responseCharacters === "number" && d.responseCharacters > d.responsePreview.length) {
            const tail = typeof d.responseTail === "string" ? d.responseTail : "";
            parts.push(`… (${d.responseCharacters} characters) …`, tail);
          }
          text = parts.join("\n");
        }
        const validation = typeof d.message === "string" ? d.message.split("; response ended with:")[0] : "";
        setRawOutput({ text: formatRawOutput(text), validation });
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
                {sizeLabel(selectedModel) && (
                  <>
                    {" "}
                    <span data-testid="model-size">{sizeLabel(selectedModel)}</span>
                  </>
                )}
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
              onChange={(event) => setSchemaVersion(event.target.value as SchemaVersion | "auto")}
              disabled={analyzing}
            >
              <option value="auto">Auto (recommended)</option>
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
            <>
              {result.lowConfidence && (
                <div className="review-alert" role="note" data-testid="low-confidence">
                  Small model — low-confidence results; verify every finding
                </div>
              )}
              {result.schemaFallback && (
                <div className="review-alert" role="note" data-testid="schema-fallback">
                  The model answered in the simpler v1 format instead of the requested v2 tables.
                </div>
              )}
              <ReviewResultView schemaVersion={result.schemaVersion} result={result.result} />
            </>
          ) : rawOutput ? (
            <>
              <div className="review-alert" role="note" data-testid="raw-output-note">
                The model&apos;s answer could not be turned into structured findings, so its raw
                output is shown below. Treat it as unverified and check every claim.
              </div>
              <pre className="review-code" aria-label="Response preview">{rawOutput.text}</pre>
              {rawOutput.validation && <p>Validation: {rawOutput.validation}</p>}
            </>
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
