"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Box, Button, Container, Flex, Heading, Tabs, Text } from "@chakra-ui/react";
import { SqlEditor } from "@/components/SqlEditor";
import { useLeaveGuard } from "@/components/leave-guard";
import { useApi } from "@/components/api-client";
import { ReviewResultView } from "@/components/review/ReviewResultView";
import { RunPicker } from "@/components/review/RunPicker";
import { NOT_SQL_ERROR, looksLikeSql } from "@/lib/validation/sql-input";
import {
  type ReviewV1,
  type ReviewV2,
  type SchemaVersion,
} from "@/lib/review-schema";
import { HighlightedCode } from "@/components/HighlightedCode";

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
  model: string | null;
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

function failureMessage(status: number, error: string | null): string {
  if (status === 429) return `The reviewer is busy. ${error ?? "Wait for the current review to finish, then retry."}`;
  if (status === 504) return "The model timed out. Try a shorter procedure, or raise inferenceTimeoutMs in Settings.";
  if (status === 502) {
    const generic = "The model's output could not be parsed as a valid review.";
    return error && error !== "Unable to parse model response" ? `${generic} ${error}` : generic;
  }
  return error ?? "Stored procedure analysis failed";
}

/** m:ss for the model-wait clock. */
function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * RV-5: review a stored procedure with the local model chosen in Settings (Review model), optionally
 * with the measured telemetry of one of the user's Execute & Audit SP runs. Findings only: a rewrite
 * comes from Refactor on Execute & Audit SP.
 */
export default function ReviewPage() {
  const api = useApi();
  const [sql, setSql] = useState("");
  const [executionAuditId, setExecutionAuditId] = useState("");
  const [result, setResult] = useState<ReviewOutput | null>(null);
  const [rawOutput, setRawOutput] = useState<{ text: string; validation: string } | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const analyzing = step !== null;
  // UX-B: leaving while the model runs asks first, and cancels the request when the user agrees.
  const abortRef = useRef<AbortController | null>(null);
  useLeaveGuard(analyzing, "A review", () => abortRef.current?.abort());
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (started === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [started]);

  const procedure = sql.trim();
  const notReady = !procedure ? "Paste a stored procedure first." : !looksLikeSql(procedure) ? NOT_SQL_ERROR : "";

  async function analyzeProcedure() {
    if (notReady) {
      setError(notReady);
      return;
    }
    setError("");
    setResult(null);
    setRawOutput(null);
    const lines = procedure.split("\n").length;
    setStep(
      `Sending the procedure (${lines.toLocaleString()} line${lines === 1 ? "" : "s"}, ${procedure.length.toLocaleString()} characters)` +
        (executionAuditId ? " with the chosen run's telemetry" : "") +
        " to the Review model chosen in Settings.",
    );
    setStarted(Date.now());
    setNow(Date.now());
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await api<ReviewResponse>(
      "/api/review",
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: procedure, ...(executionAuditId ? { executionAuditId } : {}) }),
      },
      "Stored procedure analysis failed"
    );

    if (res.ok) {
      if (res.data?.result) {
        setResult({
          model: res.data.model ?? null,
          schemaVersion: res.data.schemaVersion ?? "v2",
          lowConfidence: res.data.lowConfidence === true,
          schemaFallback: res.data.schemaFallback === true,
          result: res.data.result,
        });
      } else {
        setError("The model returned an empty result.");
      }
    } else if (controller.signal.aborted) {
      setError("Review cancelled.");
    } else if (res.status !== 401) {
      setError(failureMessage(res.status, res.error));
      const d = res.details as
        | { message?: unknown; responseText?: unknown; responsePreview?: unknown; responseTail?: unknown; responseCharacters?: unknown }
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
    abortRef.current = null;
    setStep(null);
    setStarted(null);
  }

  const panel = { bg: "bg.panel", borderWidth: "1px", borderColor: "border.subtle", borderRadius: "xl", p: 6, mb: 6 } as const;

  return (
    <Box color="fg.default">
      <Container maxW="container.xl" p={0}>
        <header className="page-header">
          <div>
            <p className="page-kicker">Analysis</p>
            <h2 className="page-title">Review Stored Procedure</h2>
            <p className="analysis-note">
              Get findings, risks and index ideas for a stored procedure from a local model. Nothing is executed.
            </p>
            <Text fontSize="xs" color="fg.muted" mt={1}>
              Model: {result?.model ?? "the Review model chosen in Settings (automatic: the best instruction-tuned model)"} ·{" "}
              <Link href="/settings" className="text-link">Change in Settings</Link>
            </Text>
          </div>
        </header>

        <Box as="section" aria-labelledby="proc-title" {...panel}>
          <Heading as="h3" id="proc-title" size="sm" color="fg.default" mb={4}>
            <span className="step-no" aria-hidden="true">1</span>Stored procedure
          </Heading>
          <SqlEditor
            ariaLabel="Stored procedure"
            value={sql}
            onChange={(next) => { setSql(next); setError(""); }}
            placeholder={"CREATE PROCEDURE dbo.GetOrders\n  @CustomerId int\nAS\nBEGIN\n  SELECT OrderId, Total\n  FROM dbo.Orders\n  WHERE CustomerId = @CustomerId;\nEND"}
            minHeight="280px" disabled={analyzing}
          />
          <Text fontSize="xs" color="fg.muted" mt={1}>{sql.length.toLocaleString()} characters</Text>
        </Box>

        <Box as="section" aria-labelledby="evidence-title" {...panel}>
          <Heading as="h3" id="evidence-title" size="sm" color="fg.default" mb={4}>
            <span className="step-no" aria-hidden="true">2</span>Evidence (optional)
          </Heading>
          <RunPicker value={executionAuditId} onChange={setExecutionAuditId} disabled={analyzing} />
        </Box>

        <Box as="section" aria-labelledby="analyze-title" className="run-bar" {...panel}>
          <Heading as="h3" id="analyze-title" size="sm" color="fg.default" mb={4}>
            <span className="step-no" aria-hidden="true">3</span>Analyze
          </Heading>
          <Flex gap={3} align="center" wrap="wrap">
            <Button colorPalette="brand" onClick={() => void analyzeProcedure()} loading={analyzing} loadingText="Analyzing..."
              disabled={analyzing || !!notReady} aria-describedby={notReady ? "analyze-why" : undefined}>
              Analyze SP
            </Button>
            {analyzing && <Button variant="outline" onClick={() => abortRef.current?.abort()}>Cancel</Button>}
            {notReady && !analyzing && <Text id="analyze-why" fontSize="sm" color="fg.muted">{notReady}</Text>}
          </Flex>
          {step && (
            <Box role="status" mt={3}>
              <Text fontSize="sm" color="accent.default">{step}</Text>
              {started !== null && (
                <Text fontSize="xs" color="fg.muted" mt={1}>
                  Waiting for the model&apos;s answer: {formatElapsed(now - started)} elapsed. A small local model usually needs a minute or more.
                </Text>
              )}
            </Box>
          )}
          {error && <div role="alert" className="alert">{error}</div>}
        </Box>

        {result && (
          <Box as="section" aria-label="Analysis results" {...panel}>
            {result.lowConfidence && (
              <div className="review-alert" role="note" data-testid="low-confidence">
                Small model: low-confidence results. Verify every finding.
              </div>
            )}
            {result.schemaFallback && (
              <div className="review-alert" role="note" data-testid="schema-fallback">
                The model answered in the short format instead of the requested tables.
              </div>
            )}
            <Tabs.Root defaultValue="summary" lazyMount variant="line">
              <Tabs.List>
                <Tabs.Trigger value="summary">Summary</Tabs.Trigger>
                <Tabs.Trigger value="findings">Findings</Tabs.Trigger>
                <Tabs.Trigger value="indexes">Index ideas</Tabs.Trigger>
              </Tabs.List>
              {(["summary", "findings", "indexes"] as const).map((part) => (
                <Tabs.Content key={part} value={part}>
                  <ReviewResultView schemaVersion={result.schemaVersion} result={result.result} part={part} />
                </Tabs.Content>
              ))}
            </Tabs.Root>
            <Text fontSize="sm" color="fg.muted" mt={4}>
              Need a rewritten procedure? Run it on <Link href="/execute" className="text-link">Execute &amp; Audit SP</Link> and use Refactor.
            </Text>
          </Box>
        )}

        {rawOutput && (
          <Box as="section" aria-label="Analysis results" {...panel}>
            <div className="review-alert" role="note" data-testid="raw-output-note">
              The model&apos;s answer could not be turned into structured findings, so its raw
              output is shown below. Treat it as unverified and check every claim.
            </div>
            <pre className="review-code" aria-label="Response preview"><HighlightedCode code={rawOutput.text} /></pre>
            {rawOutput.validation && <p>Validation: {rawOutput.validation}</p>}
          </Box>
        )}
      </Container>
    </Box>
  );
}
