'use client';

import { useEffect, useMemo, useState } from 'react';
import { Box, Combobox, Portal, Text, createListCollection, useFilter } from '@chakra-ui/react';
import { useApi } from '@/components/api-client';
import { normalizeTelemetry, statsFromAuditResponse, type NormalizedTelemetry } from '@/lib/review-telemetry';

type Run = {
  id: string; type: string; status: string; createdAt: string; recordNumber: number | null; simulated: boolean;
  procedure?: string | null; database?: string | null; grade?: string | null; elapsedMs: number | null; logicalReads: number | null;
};

const ms = (v: number | null) => (v === null ? 'not captured' : `${v.toLocaleString()} ms`);

/** "dbo.GetOrders · SalesDB · grade B · 120 ms · 4,210 reads · 12 Nov, 13:37" */
export function runLabel(run: Run): string {
  return [
    `#${run.recordNumber ?? '-'} ${run.procedure ?? 'SQL batch'}`,
    run.database,
    run.grade && `grade ${run.grade}`,
    run.elapsedMs !== null && `${run.elapsedMs.toLocaleString()} ms`,
    run.logicalReads !== null && `${run.logicalReads.toLocaleString()} reads`,
    run.simulated && 'simulated',
    new Date(run.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  ].filter(Boolean).join(' · ');
}

/**
 * RV-4: choose one of the user's Execute & Audit SP runs as evidence for the review, and see exactly what
 * the model will be given from it: timings, per-table I/O and the execution plan (never the raw output).
 */
export function RunPicker({ value, onChange, disabled }: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const api = useApi();
  const [runs, setRuns] = useState<Run[] | null>(null);
  // What the user is typing; null shows the chosen run's label and lists every run.
  const [query, setQuery] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  // The preview belongs to one run; a stale one (another run chosen since) is not shown.
  const [preview, setPreview] = useState<{ id: string; telemetry: NormalizedTelemetry | null; error: string } | null>(null);
  const { contains } = useFilter({ sensitivity: 'base' });

  useEffect(() => {
    let cancelled = false;
    void api<{ audits?: Run[] }>('/api/audit', { cache: 'no-store' }).then((res) => {
      if (cancelled) return;
      if (!res.ok && res.status !== 401) setListError(res.error ?? 'Unable to load your runs');
      const all = res.ok ? res.data?.audits ?? [] : [];
      setRuns(all.filter((a) => (a.type === 'EXECUTE' || a.type === 'EXECUTE_COMPARE') && a.status === 'ok'));
    });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    void api<{ response?: unknown }>(`/api/audit/${encodeURIComponent(value)}`, { cache: 'no-store' }).then((res) => {
      if (cancelled) return;
      const stats = res.ok ? statsFromAuditResponse(res.data?.response) : null;
      if (stats) setPreview({ id: value, telemetry: normalizeTelemetry(stats), error: '' });
      else if (res.status !== 401) setPreview({ id: value, telemetry: null, error: 'This run has no telemetry the review can use.' });
    });
    return () => { cancelled = true; };
  }, [api, value]);

  const labelled = useMemo(() => (runs ?? []).map((run) => ({ value: run.id, label: runLabel(run) })), [runs]);
  const matches = useMemo(() => labelled.filter((r) => contains(r.label, query ?? '')), [labelled, query, contains]);
  // shortcut: the newest 100 matches; typing narrows the list.
  const collection = useMemo(() => createListCollection({ items: matches.slice(0, 100) }), [matches]);
  const chosen = labelled.find((r) => r.value === value);
  const current = value && preview?.id === value ? preview : null;
  const telemetry = current?.telemetry ?? null;
  const previewError = current?.error ?? '';

  if (runs === null) return <Text fontSize="sm" color="fg.muted">Loading your runs...</Text>;
  if (listError) return <div role="alert" className="alert">{listError}</div>;
  if (runs.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No runs yet. Run the procedure on Execute &amp; Audit SP first to review it with measured timings and reads.
      </Text>
    );
  }

  return (
    <Box>
      <Combobox.Root
        collection={collection} size="md" openOnClick disabled={disabled}
        value={value ? [value] : []}
        inputValue={query ?? chosen?.label ?? ''}
        onInputValueChange={(e) => { if (e.reason === 'input-change') setQuery(e.inputValue); }}
        onValueChange={(e) => { onChange(e.value[0] ?? ''); setQuery(null); }}
        onOpenChange={(e) => { if (!e.open || e.reason !== 'input-change') setQuery(null); }}
      >
        <Combobox.Control>
          <Combobox.Input aria-label="Run to use as evidence" placeholder="None: review the SQL text only"
            bg="bg.canvas" borderColor="border.subtle" color="fg.default" />
          <Combobox.IndicatorGroup>
            <Combobox.ClearTrigger aria-label="Use no run" />
            <Combobox.Trigger aria-label="Show your runs" />
          </Combobox.IndicatorGroup>
        </Combobox.Control>
        <Portal>
          <Combobox.Positioner>
            <Combobox.Content bg="bg.panel" borderColor="border.subtle" maxH="320px">
              <Combobox.Empty px={3} py={2} color="fg.muted">No run matches &ldquo;{query}&rdquo;.</Combobox.Empty>
              {collection.items.map((item) => (
                <Combobox.Item key={item.value} item={item} fontSize="sm">
                  {item.label}
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              ))}
            </Combobox.Content>
          </Combobox.Positioner>
        </Portal>
      </Combobox.Root>
      <Text fontSize="xs" color="fg.muted" mt={1}>
        Optional. Pick the run of this procedure so the review can cite measured time and reads instead of guessing.
      </Text>

      {previewError && <div role="alert" className="alert">{previewError}</div>}
      {telemetry && (
        <Box as="section" aria-label="What the model will see" mt={4} p={4} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" bg="bg.raised">
          <Text fontWeight="semibold" fontSize="sm" mb={2}>What the model will see from this run</Text>
          {telemetry.simulated && (
            <Text fontSize="sm" color="status.warn" mb={2}>
              Simulated run: these numbers are not measurements, and the review is told so.
            </Text>
          )}
          <dl className="record-facts">
            <dt>Parse and compile</dt><dd>{ms(telemetry.parseAndCompileMs)} (CPU {ms(telemetry.parseAndCompileCpuMs)})</dd>
            <dt>Execution</dt><dd>{ms(telemetry.executionMs)} (CPU {ms(telemetry.executionCpuMs)})</dd>
            <dt>Total elapsed</dt><dd>{ms(telemetry.totalElapsedMs)}</dd>
            <dt>Execution plan</dt><dd>{telemetry.plan ? `included (${telemetry.plan.length.toLocaleString()} characters)` : 'not captured'}</dd>
          </dl>
          {telemetry.io.length > 0 ? (
            <table className="data-table" aria-label="Reads per table">
              <thead><tr><th>Table</th><th>Scans</th><th>Logical reads</th><th>Physical reads</th></tr></thead>
              <tbody>
                {telemetry.io.map((row, i) => (
                  <tr key={i}>
                    <td>{row.table}</td><td>{row.scanCount.toLocaleString()}</td>
                    <td>{row.logicalReads.toLocaleString()}</td><td>{row.physicalReads.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Text fontSize="sm" color="fg.muted">No per-table reads were captured.</Text>
          )}
          <details className="connect-more grade-help">
            <summary>Exactly what is sent</summary>
            <Box as="pre" mt={2} p={3} bg="bg.code" borderRadius="md" fontSize="xs" whiteSpace="pre-wrap" maxH="240px" overflow="auto">
              {JSON.stringify(telemetry, null, 2)}
            </Box>
          </details>
        </Box>
      )}
    </Box>
  );
}
