"use client";

import { useState } from "react";
import Link from "next/link";
import type { ApiResult } from "@/components/api-client";
import { Section } from "@/components/review/ReviewResultView";
import type { RefactorResult, RefactorStatus } from "@/lib/refactor-shared";
import { HighlightedCode } from '@/components/HighlightedCode';

/** RF-1: the refactor result, shared by the Refactor page and the Execute page's refactor panel. */

export type RefactorModel = { id: string; name: string; compatible: boolean; small?: boolean };

export type RefactorResponse = { id?: string; model?: string; lowConfidence?: boolean; result?: RefactorResult };

const STATUS_MESSAGES: Record<Exclude<RefactorStatus, "provided">, string> = {
  none: "The model did not return refactored SQL. Try again, add instructions, or use a larger model.",
  unsafe: "The refactored SQL was removed because it modifies data the original procedure does not.",
  truncated: "The refactored SQL was cut off at the new-token limit, so it was removed. Raise maxNewTokens in Settings.",
  invalid: "The model's answer was not a SQL Server stored procedure (no CREATE or ALTER PROCEDURE statement), so it was removed. Try again, or use a larger model.",
};

/** What to show when /api/refactor fails, or null for 401 (the client is already redirecting to login). */
export function refactorFailure(res: ApiResult<unknown>): { error: string; rawOutput: string; validation: string } | null {
  if (res.status === 401) return null;
  const error =
    res.status === 504
      ? "The model timed out. Try a shorter procedure or raise inferenceTimeoutMs in Settings."
      : res.status === 429
        ? res.error ?? "The model is busy. Wait for the current run to finish, then retry."
        : res.error ?? "Refactor failed";
  const d = res.details as { responseText?: unknown; message?: unknown } | null;
  const raw = res.status === 502 && d && typeof d.responseText === "string";
  return {
    error,
    rawOutput: raw ? (d.responseText as string) : "",
    validation: raw && typeof d.message === "string" ? d.message.split("; response ended with:")[0] : "",
  };
}

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

export function CopyButton({ text, label }: { text: string; label: string }) {
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

/** The model's raw answer when it could not be read as a refactor result. */
export function RefactorRawOutput({ rawOutput, validation }: { rawOutput: string; validation: string }) {
  return (
    <>
      <div className="review-alert" role="note">
        The model&apos;s answer could not be read, so its raw output is shown below. Treat it as unverified.
      </div>
      <pre className="review-code" aria-label="Response preview"><HighlightedCode code={rawOutput} /></pre>
      {validation && <p className="review-empty">Validation: {validation}</p>}
    </>
  );
}

/** Each part of the refactor as its own section; every script has a copy button. Nothing here runs SQL. */
export function RefactorResultView({ response, actions }: { response: RefactorResponse; actions?: React.ReactNode }) {
  const result = response.result;
  if (!result) return null;
  const failed = result.checks.filter((c) => !c.passed);
  return (
    <section className="review-report" aria-label="Refactor result">
      {response.lowConfidence && (
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
            <pre className="review-code review-code-tall" aria-label="Refactored SQL"><HighlightedCode code={result.refactoredSql} language="sql" /></pre>
            {actions}
          </>
        ) : (
          <p className="review-empty" data-testid="refactor-status">
            {STATUS_MESSAGES[result.status]}
            {result.statusDetail && ` (${result.statusDetail}.)`}
          </p>
        )}
      </Section>

      <List title="Changes" items={result.changes} />
      {result.indexRecommendations.length > 0 && (
        <Section title="Index recommendations" count={result.indexRecommendations.length}>
          <p className="review-empty">
            Suggestions only. Check existing indexes, the execution plan and write load before creating any index.
          </p>
          <ul className="review-recommendations">
            {result.indexRecommendations.map((item, i) => (
              <li key={`${item.table}-${i}`}>
                <strong>{item.table}</strong>
                <p>
                  Key: <code>{item.keyColumns.join(", ")}</code>
                  {item.includeColumns.length > 0 && <> · Include: <code>{item.includeColumns.join(", ")}</code></>}
                </p>
                {item.reason && <p>{item.reason}</p>}
                {item.createStatement && (
                  <>
                    <div className="review-code-header">
                      <span>Index script. Not run.</span>
                      <CopyButton text={item.createStatement} label={`Copy index script for ${item.table}`} />
                    </div>
                    <pre className="review-code"><HighlightedCode code={item.createStatement} language="sql" /></pre>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

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
                    <pre className="review-code"><HighlightedCode code={view.createStatement} language="sql" /></pre>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <List title="Other recommendations" items={result.otherRecommendations} />
      <List title="Limitations" items={result.limitations} />

      {response.id && (
        <p className="review-empty">
          Saved as an <Link href={`/audit/${response.id}`}>audit record</Link>.
        </p>
      )}
    </section>
  );
}
