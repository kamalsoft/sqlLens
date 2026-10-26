"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi } from "@/components/api-client";
import { IndexRecommendations, Section } from "@/components/review/ReviewResultView";
import { MAX_INSTRUCTIONS_LENGTH, type RefactorResult, type RefactorStatus } from "@/lib/refactor-shared";
import { NOT_SQL_ERROR, looksLikeSql } from "@/lib/validation/sql-input";

type Model = { id: string; name: string; compatible: boolean; small?: boolean };

type RefactorResponse = { id?: string; model?: string; lowConfidence?: boolean; result?: RefactorResult };

const STATUS_MESSAGES: Record<Exclude<RefactorStatus, "provided">, string> = {
  none: "The model did not return refactored SQL. Try again, add instructions, or use a larger model.",
  unsafe: "The refactored SQL was removed because it modifies data the original procedure does not.",
  truncated: "The refactored SQL was cut off at the new-token limit, so it was removed. Raise maxNewTokens in Settings.",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (non-secure context): fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="review-copy-button"
      aria-label={label}
      onClick={() =>
        void copyText(text).then((ok) => {
          setCopied(ok);
          if (ok) setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Section title={title} count={items.length}>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </Section>
  );
}

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
    } else if (res.status !== 401) {
      if (res.status === 504) setError("The model timed out. Try a shorter procedure or raise inferenceTimeoutMs in Settings.");
      else if (res.status === 429) setError(res.error ?? "The model is busy. Wait for the current run to finish, then retry.");
      else setError(res.error ?? "Refactor failed");
      const d = res.details as { responseText?: unknown; message?: unknown } | null;
      if (res.status === 502 && d && typeof d.responseText === "string") {
        setRawOutput(d.responseText);
        if (typeof d.message === "string") setValidation(d.message.split("; response ended with:")[0]);
      }
    }
    setRunning(false);
  }

  const result = response?.result;
  const failed = result?.checks.filter((c) => !c.passed) ?? [];

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
          ) : result ? (
            <section className="review-report" aria-label="Refactor result">
              {response?.lowConfidence && (
                <div className="review-alert" role="note">
                  Small model — low-confidence result; review every change.
                </div>
              )}
              <Section title="Summary">
                <p>{result.summary}</p>
              </Section>

              <Section title="Refactored SQL">
                {result.status === "provided" ? (
                  <>
                    {failed.length > 0 && (
                      <div className="review-alert" role="note" data-testid="checks-failed">
                        {failed.length} check(s) failed. Fix them before deploying this SQL.
                      </div>
                    )}
                    <ul className="review-checks" aria-label="Checks">
                      {result.checks.map((check) => (
                        <li key={check.id} className={check.passed ? "review-check-pass" : "review-check-fail"}>
                          <span aria-hidden="true">{check.passed ? "✓" : "✗"}</span> {check.label}
                          {check.detail && <small> — {check.detail}</small>}
                        </li>
                      ))}
                    </ul>
                    <div className="review-code-header">
                      <span>Not executed or validated against a database. Test before deploying.</span>
                      <CopyButton text={result.refactoredSql} label="Copy refactored SQL" />
                    </div>
                    <pre className="review-code review-code-tall" aria-label="Refactored SQL">{result.refactoredSql}</pre>
                  </>
                ) : (
                  <p className="review-empty" data-testid="refactor-status">
                    {STATUS_MESSAGES[result.status]}
                    {result.statusDetail && ` (${result.statusDetail}.)`}
                  </p>
                )}
              </Section>

              <List title="Changes" items={result.changes} />
              <IndexRecommendations items={result.indexRecommendations} />

              {result.viewRecommendations.length > 0 && (
                <Section title="View recommendations" count={result.viewRecommendations.length}>
                  <ul className="review-recommendations">
                    {result.viewRecommendations.map((view) => (
                      <li key={view.name}>
                        <strong>{view.name}</strong>
                        {view.reason && <p>{view.reason}</p>}
                        {view.createStatement && (
                          <>
                            <div className="review-code-header">
                              <span>Suggestion only.</span>
                              <CopyButton text={view.createStatement} label={`Copy view ${view.name}`} />
                            </div>
                            <pre className="review-code">{view.createStatement}</pre>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <List title="Other recommendations" items={result.otherRecommendations} />
              <List title="Limitations" items={result.limitations} />

              {response?.id && (
                <p className="review-empty">
                  Saved as an <Link href={`/audit/${response.id}`}>audit record</Link>.
                </p>
              )}
            </section>
          ) : rawOutput ? (
            <>
              <div className="review-alert" role="note">
                The model&apos;s answer could not be read, so its raw output is shown below. Treat it as unverified.
              </div>
              <pre className="review-code" aria-label="Response preview">{rawOutput}</pre>
              {validation && <p className="review-empty">Validation: {validation}</p>}
            </>
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
