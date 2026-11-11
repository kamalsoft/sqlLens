"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/components/api-client";
import {
  RefactorRawOutput, RefactorResultView, refactorFailure, type RefactorModel as Model, type RefactorResponse,
} from "@/components/refactor/RefactorResultView";
import { MAX_INSTRUCTIONS_LENGTH } from "@/lib/refactor-shared";
import { NOT_SQL_ERROR, looksLikeSql } from "@/lib/validation/sql-input";

export default function RefactorPage() {
  const api = useApi();
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [sql, setSql] = useState("");
  const [instructions, setInstructions] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [rawOutput, setRawOutput] = useState("");
  const [validation, setValidation] = useState("");
  const [response, setResponse] = useState<RefactorResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ models?: Model[] }>("/api/review/models", { cache: "no-store" }, "Unable to load installed models").then(
      (res) => {
        if (cancelled) return;
        if (res.ok) {
          const compatible = (res.data?.models ?? []).filter((m) => m.compatible);
          setModels(compatible);
          setModelId(compatible[0]?.id ?? "");
        } else if (res.status !== 401) {
          setError(res.error ?? "Unable to load installed models");
        }
        setLoadingModels(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function refactor() {
    const procedure = sql.trim();
    setError("");
    setRawOutput("");
    setValidation("");
    setResponse(null);
    if (!modelId) return setError("Select an installed model.");
    if (!procedure) return setError("Paste a stored procedure or query before refactoring.");
    if (!looksLikeSql(procedure)) return setError(NOT_SQL_ERROR);

    setRunning(true);
    const res = await api<RefactorResponse>(
      "/api/refactor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, sql: procedure, ...(instructions.trim() ? { instructions: instructions.trim() } : {}) }),
      },
      "Refactor failed",
    );
    if (res.ok && res.data?.result) {
      setResponse(res.data);
    } else {
      const failure = refactorFailure(res);
      if (failure) {
        setError(failure.error);
        setRawOutput(failure.rawOutput);
        setValidation(failure.validation);
      }
    }
    setRunning(false);
  }

  return (
    <main className="review-page">
      <header className="review-hero">
        <div>
          <span className="review-eyebrow">R003</span>
          <h1>Refactor Stored Procedure</h1>
          <p>
            Generate an optimized version of a stored procedure or query with a local model, plus index and view
            recommendations. Generated SQL is never executed.
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
              <h2>Configure refactor</h2>
            </div>
            <span className="review-local-badge">Local model</span>
          </div>

          <label className="review-field">
            <span>Model</span>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={loadingModels || models.length === 0 || running}>
              {loadingModels ? (
                <option value="">Loading installed models...</option>
              ) : models.length === 0 ? (
                <option value="">No compatible model installed</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="review-field">
            <span>Stored procedure or query</span>
            <textarea
              value={sql}
              onChange={(e) => {
                setSql(e.target.value);
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
              rows={16}
              spellCheck={false}
              disabled={running}
            />
            <small className="review-field-help">{sql.length.toLocaleString()} characters</small>
          </label>

          <label className="review-field">
            <span>Refactor instructions (optional)</span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS_LENGTH))}
              placeholder="For example: remove the temp table and use a single set-based query; target SQL Server 2019; keep the transaction."
              rows={4}
              disabled={running}
            />
            <small className="review-field-help">
              {instructions.length} / {MAX_INSTRUCTIONS_LENGTH} characters. Instructions guide the refactor but cannot override its safety rules.
            </small>
          </label>

          <button
            type="button"
            className="review-analyze-button"
            onClick={() => void refactor()}
            disabled={running || !sql.trim() || !modelId}
          >
            {running ? "Refactoring..." : "Refactor"}
          </button>
        </div>

        <div className="review-panel review-results-panel">
          <div className="review-panel-heading">
            <div>
              <span className="review-step">02</span>
              <h2>Refactor result</h2>
            </div>
          </div>

          {running ? (
            <div className="review-state" role="status">
              <div className="review-spinner" />
              <strong>Running local refactor</strong>
              <p>The selected model is rewriting your procedure.</p>
            </div>
          ) : response?.result ? (
            <RefactorResultView response={response} />
          ) : rawOutput ? (
            <RefactorRawOutput rawOutput={rawOutput} validation={validation} />
          ) : (
            <div className="review-state">
              <div className="review-state-icon">✦</div>
              <strong>No refactor yet</strong>
              <p>Select a model, paste a stored procedure, optionally add instructions, and choose Refactor.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
