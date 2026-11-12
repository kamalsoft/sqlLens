'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useApi } from '@/components/api-client';
import { useLeaveGuard } from '@/components/leave-guard';
import {
  RefactorRawOutput, RefactorResultView, refactorFailure, type RefactorResponse,
} from '@/components/refactor/RefactorResultView';
import type { AuditAnalysis } from '@/lib/audit-analyzer';
import { evidenceInstructions } from '@/lib/refactor-evidence';

/** m:ss for the model-wait clock. */
function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** What was run: a pasted batch, or a procedure by name (its text is read from the catalog). */
export type RefactorSource = { kind: 'batch'; sql: string } | { kind: 'procedure'; name: string };

type Engine = 'simulation' | 'mssql' | 'postgres';

/**
 * RF-2/RF-3: after a run, refactor what was run with a local model and show the refactored SQL, the
 * index and view scripts and the other recommendations, each in its own section. Nothing here runs SQL.
 * It sits inline in the Refactor tab, styled like the other result tabs. The model is chosen in Settings
 * (Refactor model); left on automatic, the server picks an installed, compatible model with a chat template, instruction-tuned names (Instruct, Chat, -it) first, then the largest parameter estimate.
 */
export function RefactorPanel({ source, engine, connection, analysis, onUseAsOptimized }: {
  source: RefactorSource;
  engine: Engine;
  /** The connection the run used (a snapshot, so later edits to the form do not change the target). */
  connection: Record<string, unknown>;
  analysis: AuditAnalysis;
  /** RF-6: offered for batches only; a procedure's refactor is a CREATE script, not something to time. */
  onUseAsOptimized?: (sql: string) => void;
}) {
  const api = useApi();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [rawOutput, setRawOutput] = useState('');
  const [validation, setValidation] = useState('');
  const [response, setResponse] = useState<RefactorResponse | null>(null);
  const instructions = evidenceInstructions(analysis);
  // A model run can take minutes; stop it when the panel goes away (a new run, or Use as Optimized).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  // While the model runs, a clock shows how long it has been working.
  const [modelStarted, setModelStarted] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (modelStarted === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [modelStarted]);

  /** The SQL text to refactor: the batch as run, or the procedure's definition from SQL Server. */
  async function sourceSql(): Promise<string | null> {
    if (source.kind === 'batch') return source.sql;
    if (engine !== 'mssql') {
      setError('Reading a procedure needs a live SQL Server connection. Run it against SQL Server, or switch to SQL batch and paste the procedure text.');
      return null;
    }
    setStep(`Reading the definition of ${source.name} from SQL Server...`);
    const res = await api<{ definition?: string }>(
      '/api/execute/definition',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine, name: source.name, connection }), signal: abortRef.current?.signal },
      'Could not read the procedure definition',
    );
    if (res.ok && res.data?.definition) return res.data.definition;
    if (res.status !== 401) setError(res.error ?? 'Could not read the procedure definition');
    return null;
  }

  async function generate() {
    setError('');
    setRawOutput('');
    setValidation('');
    setResponse(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setStep('Preparing...');
    const sql = await sourceSql();
    if (sql === null) { setStep(null); return; }
    const what = source.kind === 'procedure' ? source.name : 'the SQL batch';
    const lines = sql.split('\n').length;
    const verdict = analysis.prodVerdict?.verdict;
    const hot = analysis.ioAnalysis?.hotTables?.length ?? 0;
    const findings = analysis.planFindings?.length ?? 0;
    const evidence = [verdict && `verdict ${verdict}`, `${hot} hot table${hot === 1 ? '' : 's'}`, `${findings} plan finding${findings === 1 ? '' : 's'}`]
      .filter(Boolean).join(', ');
    setStep(`Sending ${what} (${lines.toLocaleString()} lines, ${sql.length.toLocaleString()} characters) with this run's evidence (${evidence}) to the refactor model chosen in Settings.`);
    setModelStarted(Date.now());
    setNow(Date.now());
    const res = await api<RefactorResponse>(
      '/api/refactor',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, instructions }), signal: abortRef.current.signal },
      'Refactor failed',
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
    setStep(null);
    setModelStarted(null);
  }

  const running = step !== null;
  useLeaveGuard(running, 'A refactor', () => abortRef.current?.abort());
  const refactoredSql = response?.result?.status === 'provided' ? response.result.refactoredSql : '';
  const actions = refactoredSql
    ? source.kind === 'batch' && onUseAsOptimized
      ? (
        <Flex mt={3} gap={3} align="center" wrap="wrap">
          <Button size="sm" colorPalette="brand" onClick={() => onUseAsOptimized(refactoredSql)}>Use as Optimized</Button>
          <Text fontSize="xs" color="fg.muted">Puts this SQL in the Optimized editor in Compare mode. Nothing runs until you press Execute.</Text>
        </Flex>
      )
      : (
        <Text mt={3} fontSize="xs" color="fg.muted">
          To compare it, create the refactored procedure under a new name in a test database, then run both in Compare mode.
        </Text>
      )
    : null;

  return (
    <Box as="section" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" overflow="hidden" aria-label="Refactor stored procedure">
      <Box bg="bg.raised" px={6} py={4} borderBottomWidth="1px" borderColor="border.subtle">
        <Flex justify="space-between" align="flex-start" gap={4} wrap="wrap">
          <Box flex="1 1 320px">
            <Heading size="md" color="fg.default">Refactor Stored Procedure</Heading>
            <Text fontSize="sm" color="fg.muted" mt={1}>
              {source.kind === 'procedure'
                ? `Refactors ${source.name}; its definition is read from SQL Server.`
                : 'Refactors the SQL batch exactly as it was run.'}
              {' '}Generated SQL is never executed.
            </Text>
            <Text fontSize="xs" color="fg.muted" mt={1}>
              Model: {response?.model ?? 'the one chosen in Settings (automatic: the best instruction-tuned model)'} ·{' '}
              <Link href="/settings" className="text-link">Change in Settings</Link>
            </Text>
          </Box>
          <Button colorPalette="brand" onClick={() => void generate()} loading={running} loadingText="Generating..." disabled={running}>
            Generate refactor
          </Button>
        </Flex>
        <details className="connect-more grade-help">
          <summary>Evidence sent to the model</summary>
          <Box as="pre" mt={2} p={3} bg="bg.code" borderRadius="md" fontSize="xs" color="fg.default" whiteSpace="pre-wrap">{instructions}</Box>
        </details>
      </Box>

      <Box px={6} py={6} display="flex" flexDirection="column" gap={4}>
        {step && (
          <Box role="status">
            <Text fontSize="sm" color="accent.default">{step}</Text>
            {modelStarted !== null && (
              <Text fontSize="xs" color="fg.muted" mt={1}>
                Waiting for the model&apos;s answer: {formatElapsed(now - modelStarted)} elapsed. A small local model usually needs a few minutes for a whole procedure.
              </Text>
            )}
          </Box>
        )}
        {error && <div role="alert" className="alert">{error}</div>}
        {response?.result && <RefactorResultView response={response} actions={actions} />}
        {!response && rawOutput && <RefactorRawOutput rawOutput={rawOutput} validation={validation} />}
        {!response && !rawOutput && !error && !step && (
          <Text fontSize="sm" color="fg.muted">
            Press Generate refactor for a refactored version, index and view scripts and other recommendations, guided by this run&apos;s evidence.
          </Text>
        )}
      </Box>
    </Box>
  );
}
