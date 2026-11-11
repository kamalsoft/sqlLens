'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useApi } from '@/components/api-client';
import {
  RefactorRawOutput, RefactorResultView, refactorFailure, type RefactorModel, type RefactorResponse,
} from '@/components/refactor/RefactorResultView';
import type { AuditAnalysis } from '@/lib/audit-analyzer';
import { evidenceInstructions } from '@/lib/refactor-evidence';

/** What was run: a pasted batch, or a procedure by name (its text is read from the catalog). */
export type RefactorSource = { kind: 'batch'; sql: string } | { kind: 'procedure'; name: string };

type Engine = 'simulation' | 'mssql' | 'postgres';

/**
 * RF-2/RF-3: after a run, refactor what was run with a local model and show the refactored SQL, the
 * index and view scripts and the other recommendations, each in its own section. Nothing here runs SQL.
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
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<RefactorModel[] | null>(null);
  const [modelId, setModelId] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [rawOutput, setRawOutput] = useState('');
  const [validation, setValidation] = useState('');
  const [response, setResponse] = useState<RefactorResponse | null>(null);
  const instructions = open ? evidenceInstructions(analysis) : '';
  // A model run can take minutes; stop it when the panel goes away (a new run, or Use as Optimized).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function openPanel() {
    setOpen(true);
    if (models !== null) return;
    const res = await api<{ models?: RefactorModel[] }>('/api/review/models', { cache: 'no-store' }, 'Unable to load installed models');
    if (res.ok) {
      const compatible = (res.data?.models ?? []).filter((m) => m.compatible);
      setModels(compatible);
      setModelId(compatible[0]?.id ?? '');
    } else {
      setModels([]);
      if (res.status !== 401) setError(res.error ?? 'Unable to load installed models');
    }
  }

  /** The SQL text to refactor: the batch as run, or the procedure's definition from SQL Server. */
  async function sourceSql(): Promise<string | null> {
    if (source.kind === 'batch') return source.sql;
    if (engine !== 'mssql') {
      setError('Reading a procedure needs a live SQL Server connection. Run it against SQL Server, or switch to SQL batch and paste the procedure text.');
      return null;
    }
    setStep('Reading the procedure definition...');
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
    if (!modelId) { setError('Select an installed model.'); return; }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setStep('Preparing...');
    const sql = await sourceSql();
    if (sql === null) { setStep(null); return; }
    setStep('Running the local model. This can take a few minutes...');
    const res = await api<RefactorResponse>(
      '/api/refactor',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId, sql, instructions }), signal: abortRef.current.signal },
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
  }

  const running = step !== null;
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
    <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5} aria-label="Refactor stored procedure">
      <Flex justify="space-between" align="center" gap={3} wrap="wrap">
        <Box>
          <Heading size="sm" color="fg.default">Refactor Stored Procedure</Heading>
          <Text fontSize="sm" color="fg.muted" mt={1}>
            Generate a refactored version and index, view and other recommendation scripts with a local model,
            guided by this run&apos;s evidence. Generated SQL is never executed.
          </Text>
        </Box>
        {!open && <Button colorPalette="brand" onClick={() => void openPanel()}>Refactor Stored Procedure</Button>}
      </Flex>

      {open && (
        <Box mt={4} display="flex" flexDirection="column" gap={4}>
          <Flex gap={3} align="flex-end" wrap="wrap">
            <label className="field" style={{ flex: '1 1 260px' }}>
              <span className="label">Model</span>
              <select className="select" value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={models === null || models.length === 0 || running}>
                {models === null ? <option value="">Loading installed models...</option>
                  : models.length === 0 ? <option value="">No compatible model installed</option>
                    : models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <Button colorPalette="brand" onClick={() => void generate()} disabled={running || !modelId} loading={running}>
              Generate refactor
            </Button>
          </Flex>
          <Text fontSize="xs" color="fg.muted">
            {source.kind === 'procedure'
              ? `Refactors ${source.name}; its definition is read from SQL Server.`
              : 'Refactors the SQL batch exactly as it was run.'}
          </Text>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>Evidence sent to the model</summary>
            <Box as="pre" mt={2} p={3} bg="bg.code" borderRadius="md" fontSize="xs" color="fg.default" whiteSpace="pre-wrap">{instructions}</Box>
          </details>

          {step && <Text role="status" fontSize="sm" color="accent.default">{step}</Text>}
          {error && <div role="alert" className="alert">{error}</div>}
          {response?.result && <RefactorResultView response={response} actions={actions} />}
          {!response && rawOutput && <RefactorRawOutput rawOutput={rawOutput} validation={validation} />}
        </Box>
      )}
    </Box>
  );
}
