"use client";

import { useEffect, useState } from "react";

type Model = {
  id: string;
  name: string;
  directory?: string;
  compatible: boolean;
};

type ReviewResponse = {
  model?: string;
  result?: string;
  error?: string;
};

export default function ReviewPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    async function loadModels() {
      try {
        const response = await fetch("/api/review/models", {
          cache: "no-store",
        });

        const payload = (await response.json()) as {
          models?: Model[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load installed models");
        }

        const installedModels = payload.models ?? [];
        setModels(installedModels);
        setModelId(installedModels[0]?.id ?? "");
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load installed models"
        );
      } finally {
        setLoadingModels(false);
      }
    }

    void loadModels();
  }, []);

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
    setResult("");

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          sql: procedure,
          max_new_tokens: 1200,
          temperature: 0.2,
          do_sample: false,
          return_full_text: false,
        }),
      });

      const payload = (await response.json()) as ReviewResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Stored procedure analysis failed");
      }

      if (!payload.result) {
        throw new Error("The selected model returned an empty result.");
      }

      setResult(payload.result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Stored procedure analysis failed"
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const selectedModel = models.find((model) => model.id === modelId);
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
              </small>
            )}
          </label>

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
            <div className="review-state">
              <div className="review-spinner" />
              <strong>Running local analysis</strong>
              <p>The selected model is processing your procedure.</p>
            </div>
          ) : result ? (
            <pre className="review-result">{result}</pre>
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
