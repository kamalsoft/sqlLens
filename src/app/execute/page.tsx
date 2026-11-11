'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Box, Container, Heading, Text, Button, Flex,
  Spinner, Badge, Grid, Input, Separator,
} from '@chakra-ui/react';
import { GRADE_RULES, STANDARD_RECOMMENDATIONS, type AuditAnalysis, type Grade, type PlanFinding, type ProdVerdict } from '@/lib/audit-analyzer';
import type { ExecParam } from '@/components/execute/target-editor';
import type { ExecutionResult } from '@/lib/sp-executor';
import { useApi } from '@/components/api-client';
import { gradeToken, VERDICT_TONE, verdictTone } from '@/lib/status-tone';
import { RefactorPanel, type RefactorSource } from '@/components/execute/refactor-panel';
import { readParamSets, setNamesFor, withSet, withoutSet, writeParamSets, type ParamSetStore, type SavedParam } from '@/lib/param-sets';
import {
  TargetEditor, buildTarget, emptyDraft, isDraftEmpty, targetError, newParamRow, type ParamType, type TargetDraft,
} from '@/components/execute/target-editor';

type ComparisonAnalysis = AuditAnalysis & {
  improvementPercent?: number | null;
  comparisonSummary?: string;
};
type Side = { execution: ExecutionResult; analysis: AuditAnalysis };
// Mirrors the result built in src/app/api/execute/route.ts.
type ExecuteResult =
  | { mode: 'single'; simulated?: boolean;
  warnings?: string[]; execution: ExecutionResult; analysis: AuditAnalysis }
  | {
      mode: 'compare';
      simulated?: boolean;
  warnings?: string[];
      original: Side;
      optimized: Side;
      comparison: ComparisonAnalysis;
    };
type TestInfo = { ok: boolean; message: string };

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GradeBadge({ grade }: { grade: string | null }) {
  if (grade === null) {
    return <Badge colorPalette="gray" variant="subtle" px={3} py={2}>Not graded</Badge>;
  }
  // The letter carries the meaning; the colour is a second cue (colour-vision safe palette, theme-tokens.ts).
  const tone = gradeToken(grade);
  return (
    <Box
      display="inline-flex" alignItems="center" justifyContent="center"
      w="56px" h="56px" borderRadius="full" bg="bg.canvas"
      borderWidth="2px" borderColor={tone}
      fontSize="2xl" fontWeight="black" color={tone} aria-label={`Grade ${grade}`}
    >
      {grade}
    </Box>
  );
}

function VerdictCard({ verdict }: { verdict: ProdVerdict }) {
  const tone = verdictTone(verdict.verdict);
  return (
    <Box p={4} bg="bg.canvas" borderRadius="lg" borderLeftWidth="4px" borderColor={tone.token} aria-label="Prod-readiness verdict">
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">Prod readiness</Text>
      <Text fontSize="xl" fontWeight="bold" color={tone.token}>
        <Box as="span" aria-hidden="true" mr={2}>{tone.symbol}</Box>{verdict.verdict}
      </Text>
      <Text fontSize="sm" color="fg.default">{verdict.reason}{verdict.driver ? ` (${verdict.driver})` : ''}</Text>
    </Box>
  );
}

/** The verdict key: each state with its symbol and colour, so the meaning is written out, not only shown. */
function VerdictKey() {
  return (
    <Box aria-label="Verdict key" display="flex" flexWrap="wrap" gap={4} fontSize="xs" color="fg.muted">
      {Object.entries(VERDICT_TONE).map(([name, t]) => (
        <Box key={name} as="span" color={t.token} fontWeight="semibold"><span aria-hidden="true">{t.symbol} </span>{name}</Box>
      ))}
    </Box>
  );
}

function StatCard({ label, value, unit = '', color = 'accent.default' }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  return (
    <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={4} textAlign="center">
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={1}>{label}</Text>
      <Text fontSize="2xl" fontWeight="bold" color={color}>{value === null ? 'Not captured' : value.toLocaleString()}</Text>
      {unit && value !== null && <Text fontSize="xs" color="fg.muted">{unit}</Text>}
    </Box>
  );
}

const FINDING_WHY: Record<PlanFinding['kind'], string> = {
  'cost-concentration': 'Most of the logical reads come from one operator, so changing it moves the total most.',
  'row-estimate': 'The optimizer planned for far fewer rows than it read, so the chosen plan may not fit this data.',
  'tempdb-spill': 'Work that did not fit in memory was written to tempdb, which is much slower than memory.',
};

function FindingCard({ finding }: { finding: PlanFinding }) {
  return (
    <Box p={4} bg="bg.canvas" borderRadius="lg" borderLeftWidth="3px" borderColor={finding.severity === 'high' ? 'status.bad' : 'status.warn'}>
      <Text color="fg.default" fontWeight="semibold" fontSize="sm">{finding.message}</Text>
      <Text color="fg.default" fontSize="sm" mt={2}>{finding.recommendation}</Text>
      <Text color="fg.muted" fontSize="xs" mt={2}>Why: {FINDING_WHY[finding.kind]}</Text>
    </Box>
  );
}

/** P8-08: dedicated recommendations: findings by priority, other observations, and the standard checks. */
function RecommendationsPanel({ analysis }: { analysis: AuditAnalysis }) {
  const findings = analysis.planFindings ?? [];
  const findingTexts = new Set(findings.map((f) => f.recommendation));
  const standard = new Set<string>(STANDARD_RECOMMENDATIONS);
  const other = analysis.recommendations.filter((r) => !findingTexts.has(r) && !standard.has(r));
  const high = findings.filter((f) => f.severity === 'high');
  const medium = findings.filter((f) => f.severity === 'medium');
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="xl" bg="bg.panel" p={5} aria-label="Recommendations" display="flex" flexDirection="column" gap={5}>
      <Box>
        <Heading size="sm" color="accent.default">💡 Recommendations</Heading>
        <Text fontSize="xs" color="fg.muted" mt={1}>
          How to use: start with the verdict, take the first high-priority finding, change the SQL, then run the changed SQL in compare mode and check that the verdict and grade improve.
        </Text>
      </Box>
      {findings.length === 0 && other.length === 0 && (
        <Text fontSize="sm" color="fg.muted">No plan findings for this run.</Text>
      )}
      {high.length > 0 && (
        <Box>
          <Text fontSize="xs" color="status.bad" textTransform="uppercase" letterSpacing="wider" mb={2}>High priority</Text>
          <Box display="flex" flexDirection="column" gap={2}>{high.map((f, i) => <FindingCard key={`h${i}`} finding={f} />)}</Box>
        </Box>
      )}
      {medium.length > 0 && (
        <Box>
          <Text fontSize="xs" color="status.warn" textTransform="uppercase" letterSpacing="wider" mb={2}>Medium priority</Text>
          <Box display="flex" flexDirection="column" gap={2}>{medium.map((f, i) => <FindingCard key={`m${i}`} finding={f} />)}</Box>
        </Box>
      )}
      {other.length > 0 && (
        <Box>
          <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={2}>Other observations</Text>
          <Box as="ul" pl={5} display="flex" flexDirection="column" gap={1}>
            {other.map((r, i) => <Box as="li" key={i} color="fg.default" fontSize="sm">{r}</Box>)}
          </Box>
        </Box>
      )}
      <Box>
        <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={2}>Standard checks</Text>
        <Box as="ul" pl={5} display="flex" flexDirection="column" gap={1}>
          {STANDARD_RECOMMENDATIONS.map((r) => <Box as="li" key={r} color="fg.default" fontSize="sm">{r}</Box>)}
        </Box>
      </Box>
    </Box>
  );
}

/** P8-08: the grade scale, with the current run's grade marked. */
function GradeLegend({ current }: { current: Grade | null }) {
  const meaning: Record<Grade, string> = {
    A: 'Excellent', B: 'Good', C: 'Moderate: investigate before scaling', D: 'Poor: refactor before scale', F: 'Critical: act now',
  };
  const grades: Grade[] = ['A', 'B', 'C', 'D', 'F'];
  return (
    <Box overflowX="auto" aria-label="Grade legend">
      <Box as="table" fontSize="xs" color="fg.default" w="100%">
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            <th>Grade</th><th>Logical reads</th><th>Time</th><th>Scans</th><th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((g) => {
            const rule = g === 'F' ? null : GRADE_RULES[g];
            const isCurrent = current === g;
            return (
              <tr key={g} style={{ background: isCurrent ? 'var(--panel-strong)' : undefined }}>
                <td><strong>{g}</strong>{isCurrent ? ' ◀' : ''}</td>
                <td>{rule ? `under ${rule.reads.toLocaleString()}` : `not under D's limits`}</td>
                <td>{rule ? `under ${rule.ms.toLocaleString()} ms` : 'not under D\'s limit'}</td>
                <td>{rule?.scans != null ? `at most ${rule.scans}` : rule ? 'any' : '—'}</td>
                <td>{meaning[g]}</td>
              </tr>
            );
          })}
        </tbody>
      </Box>
      <Text fontSize="xs" color="fg.muted" mt={2}>
        A run must be under every limit of a grade. &quot;Not graded&quot; means the evidence is incomplete (see the verdict reason).
      </Text>
    </Box>
  );
}

/** P8-08: the original and the optimized SQL with their measured metrics, side by side. */
function OptimizedPanel({ original, optimized, originalText, optimizedText }: {
  original: AuditAnalysis; optimized: AuditAnalysis; originalText: string; optimizedText: string;
}) {
  const sides = [
    { label: 'Original', color: 'accent.default', analysis: original, text: originalText },
    { label: 'Optimized', color: 'status.ok', analysis: optimized, text: optimizedText },
  ];
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="xl" bg="bg.panel" p={5} aria-label="Original and optimized SQL">
      <Heading size="sm" color="status.ok" mb={4}>🟢 Original vs Optimized</Heading>
      <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
        {sides.map((side) => (
          <Box key={side.label} p={4} bg="bg.canvas" borderRadius="lg" borderLeftWidth="3px" borderColor={side.color}>
            <Text fontSize="xs" color={side.color} textTransform="uppercase" letterSpacing="wider">{side.label}</Text>
            <Text fontSize="sm" color="fg.default" mt={1}>
              Grade {side.analysis.performanceGrade ?? 'not graded'} · {side.analysis.ioAnalysis.totalLogicalReads === null ? 'reads not captured' : `${side.analysis.ioAnalysis.totalLogicalReads.toLocaleString()} logical reads`} · {side.analysis.timeAnalysis.totalMs === null ? 'time not captured' : `${side.analysis.timeAnalysis.totalMs} ms`}
            </Text>
            <Text fontSize="xs" color="fg.muted" mt={1}>{side.analysis.prodVerdict?.verdict ?? ''}</Text>
            <Box as="pre" mt={3} p={3} bg="bg.code" borderRadius="md" fontSize="xs" color="fg.default" maxH="320px" overflow="auto" whiteSpace="pre-wrap">
              {side.text || '(empty)'}
            </Box>
          </Box>
        ))}
      </Grid>
      <Text fontSize="xs" color="fg.muted" mt={3}>
        Refactor output from the Refactor page is not run here. Paste it into Optimized SP and run it; SQL runs only when you press the button.
      </Text>
    </Box>
  );
}

function AnalysisPanel({ analysis, title, params, outputs }: {
  analysis: AuditAnalysis; title: string; params?: ExecParam[]; outputs?: Record<string, unknown>;
}) {
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="xl" overflow="hidden">
      <Box bg="bg.raised" px={6} py={4} borderBottomWidth="1px" borderColor="border.subtle">
        <Flex align="center" gap={4}>
          <GradeBadge grade={analysis.performanceGrade} />
          <Box>
            <Heading size="md" color="fg.default">{title}</Heading>
            <Text fontSize="sm" color="fg.muted">{analysis.gradeRationale}</Text>
          </Box>
        </Flex>
        <Box mt={3}><GradeLegend current={analysis.performanceGrade} /></Box>
      </Box>

      <Box px={6} py={6} display="flex" flexDirection="column" gap={6}>
        {/* Verdict first (P8-04) */}
        {analysis.prodVerdict && <><VerdictCard verdict={analysis.prodVerdict} /><VerdictKey /></>}

        {/* Summary */}
        <Text color="fg.default" lineHeight="tall">{analysis.summary}</Text>

        <Separator borderColor="border.subtle" />

        {/* Stats */}
        <Grid templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap={4}>
          <StatCard label="Total Logical Reads" value={analysis.ioAnalysis.totalLogicalReads} color="accent.default" />
          <StatCard label="Physical Reads" value={analysis.ioAnalysis.totalPhysicalReads} color={analysis.ioAnalysis.totalPhysicalReads === null ? 'fg.muted' : analysis.ioAnalysis.totalPhysicalReads > 0 ? 'status.warn' : 'status.ok'} />
          <StatCard label="Scan Count" value={analysis.ioAnalysis.totalScanCount} color={analysis.ioAnalysis.totalScanCount === null ? 'fg.muted' : analysis.ioAnalysis.totalScanCount > 3 ? 'status.bad' : 'status.ok'} />
          <StatCard label="Total Time" value={analysis.timeAnalysis.totalMs} unit="ms" color={analysis.timeAnalysis.totalMs === null ? 'fg.muted' : analysis.timeAnalysis.totalMs > 1000 ? 'status.bad' : 'status.ok'} />
        </Grid>

        <Separator borderColor="border.subtle" />

        {/* Row counts for the real tables the run read (D-039) */}
        {analysis.ioAnalysis.rowCounts && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={3} textTransform="uppercase" letterSpacing="wider">Row counts (tables read)</Text>
            <Grid templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap={3}>
              {Object.entries(analysis.ioAnalysis.rowCounts).map(([table, rows]) => (
                <StatCard key={table} label={table} value={rows} color={rows === 0 ? 'status.bad' : 'accent.default'} />
              ))}
            </Grid>
          </Box>
        )}

        {/* Repeated runs (P8-03) */}
        {analysis.multiRun && (
          <Box p={4} bg="bg.canvas" borderRadius="lg" borderLeftWidth="3px" borderColor="accent.default" aria-label="Repeated runs summary">
            <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
              {analysis.multiRun.runs} measured runs (warm-up of {analysis.multiRun.warmupRuns} dropped)
            </Text>
            <Text color="fg.default" fontSize="sm">
              Elapsed median {analysis.multiRun.elapsedMs?.median ?? 'n/a'} ms, p95 {analysis.multiRun.elapsedMs?.p95 ?? 'n/a'} ms,
              spread {analysis.multiRun.spreadPct === null ? 'n/a' : `${Math.round(analysis.multiRun.spreadPct)}%`}.
              Logical reads median {analysis.multiRun.logicalReads?.median ?? 'n/a'}.
            </Text>
          </Box>
        )}

        {/* Parameters used (P8-04) */}
        {params && params.length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Parameters used</Text>
            <Box as="dl" display="grid" gridTemplateColumns={{ base: '1fr', md: 'auto 1fr' }} gap={2} fontSize="sm">
              {params.map((p, i) => (
                <Flex key={i} gap={2} align="baseline" wrap="wrap" gridColumn="1 / -1">
                  <Text as="dt" color="fg.muted" fontFamily="mono">{p.name}</Text>
                  <Text as="dd" color="fg.default" fontFamily="mono">{p.value === null ? 'NULL' : String(p.value)} <Text as="span" color="fg.muted">({p.type})</Text></Text>
                  {p.output && <Badge colorPalette="brand" size="sm">OUTPUT</Badge>}
                </Flex>
              ))}
            </Box>
          </Box>
        )}

        {/* OUTPUT parameter values returned by the run */}
        {outputs && Object.keys(outputs).length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={3} textTransform="uppercase" letterSpacing="wider">OUTPUT parameters</Text>
            <Box as="pre" fontSize="xs" color="accent.default" bg="bg.canvas" p={3} borderRadius="lg" overflowX="auto" fontFamily="mono">
              {JSON.stringify(outputs, null, 2)}
            </Box>
          </Box>
        )}

        {/* Time breakdown */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={3} textTransform="uppercase" letterSpacing="wider">⏱ Time Analysis</Text>
          <Grid templateColumns="1fr 1fr" gap={4}>
            <Box p={4} bg="bg.raised" borderRadius="lg">
              <Text fontSize="xs" color="fg.muted" mb={1}>Parse & Compile</Text>
              <Text color="accent.default" fontWeight="bold">{analysis.timeAnalysis.parseTimeMs === null ? 'Not captured' : `${analysis.timeAnalysis.parseTimeMs}ms`}</Text>
            </Box>
            <Box p={4} bg="bg.raised" borderRadius="lg">
              <Text fontSize="xs" color="fg.muted" mb={1}>Execution</Text>
              <Text color="accent.default" fontWeight="bold">{analysis.timeAnalysis.executeTimeMs === null ? 'Not captured' : `${analysis.timeAnalysis.executeTimeMs}ms`}</Text>
            </Box>
          </Grid>
          <Box mt={3} p={4} bg="bg.raised" borderRadius="lg" borderLeftWidth="3px" borderColor="accent.default">
            <Text color="fg.default" fontSize="sm">{analysis.timeAnalysis.classification}</Text>
            <Text color="fg.muted" fontSize="xs" mt={1}>{analysis.timeAnalysis.recommendation}</Text>
          </Box>
        </Box>

        <Separator borderColor="border.subtle" />

        {/* Costliest plan operators (P8-06) */}
        {analysis.planOperators && analysis.planOperators.length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="accent.default" mb={3} textTransform="uppercase" letterSpacing="wider">Costliest plan operators</Text>
            <Box display="flex" flexDirection="column" gap={2}>
              {analysis.planOperators.map((op, i) => (
                <Box key={i} p={4} bg="bg.raised" borderRadius="lg" borderLeftWidth="3px" borderColor="accent.default">
                  <Text color="fg.default" fontWeight="semibold" fontSize="sm">{op.physicalOp}{op.table ? ` on ${op.table}` : ''}</Text>
                  <Text color="fg.muted" fontSize="xs" mt={1}>
                    {op.logicalReads === null ? 'reads not captured' : `${op.logicalReads.toLocaleString()} logical reads`}
                    {' · '}{op.actualRows === null ? 'rows not captured' : `${op.actualRows.toLocaleString()} rows`}
                    {op.executions !== null && op.executions > 1 ? ` · ${op.executions.toLocaleString()} executions` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Hot tables */}
        {analysis.ioAnalysis.hotTables.length > 0 && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="status.warn" mb={3} textTransform="uppercase" letterSpacing="wider">🔥 Hot Tables (I/O)</Text>
            <Box display="flex" flexDirection="column" gap={2}>
              {analysis.ioAnalysis.hotTables.map((ht, i) => (
                <Box key={i} p={4} bg="bg.raised" borderRadius="lg" borderLeftWidth="3px"
                  borderColor={ht.concern.startsWith('HIGH') ? 'status.bad' : ht.concern.startsWith('MEDIUM') ? 'status.warn' : 'status.ok'}>
                  <Flex justify="space-between" align="flex-start">
                    <Box>
                      <Text color="fg.default" fontWeight="semibold" fontSize="sm">{ht.table}</Text>
                      <Text color="fg.muted" fontSize="xs" mt={1}>{ht.concern}</Text>
                    </Box>
                    <Flex gap={4} textAlign="right">
                      <Box>
                        <Text fontSize="xs" color="fg.muted">Logical Reads</Text>
                        <Text color="status.warn" fontWeight="bold">{ht.logicalReads.toLocaleString()}</Text>
                      </Box>
                      <Box>
                        <Text fontSize="xs" color="fg.muted">Scans</Text>
                        <Text color={ht.scanCount > 10 ? 'status.bad' : 'fg.default'} fontWeight="bold">{ht.scanCount}</Text>
                      </Box>
                    </Flex>
                  </Flex>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Separator borderColor="border.subtle" />

        {/* Pros & Cons */}
        <Grid templateColumns="1fr 1fr" gap={4}>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="status.ok" mb={3} textTransform="uppercase" letterSpacing="wider">✅ Pros</Text>
            {analysis.prosAndCons.pros.map((p, i) => (
              <Flex key={i} gap={2} mb={2} align="flex-start">
                <Text color="status.ok">+</Text>
                <Text color="fg.default" fontSize="sm">{p}</Text>
              </Flex>
            ))}
          </Box>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="status.bad" mb={3} textTransform="uppercase" letterSpacing="wider">❌ Cons</Text>
            {analysis.prosAndCons.cons.map((c, i) => (
              <Flex key={i} gap={2} mb={2} align="flex-start">
                <Text color="status.bad">−</Text>
                <Text color="fg.default" fontSize="sm">{c}</Text>
              </Flex>
            ))}
          </Box>
        </Grid>

        <Separator borderColor="border.subtle" />

        <RecommendationsPanel analysis={analysis} />
      </Box>
    </Box>
  );
}

function RawStatsPanel({ execution }: { execution: ExecutionResult }) {
  const [show, setShow] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const raw = execution.stats.rawOutput;
  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopyState('copied');
    } catch {
      // Clipboard can be blocked (permissions, insecure page): the text stays selectable in the panel.
      setCopyState('failed');
    }
  };
  return (
    <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" overflow="hidden">
      <Flex justify="space-between" align="center" px={5} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="fg.default">📄 Raw Execution Output</Text>
          <Text fontSize="xs" color="fg.muted">The server&apos;s messages for this run: the STATISTICS IO and TIME lines and the plan XML. Every number on this page is parsed from this text.</Text>
        </Box>
        <Flex gap={2} align="center">
          <Button size="xs" variant="outline" colorPalette="brand" aria-label="Copy raw output" onClick={copyRaw} disabled={!raw}>
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
          </Button>
          <Button size="xs" variant="ghost" colorPalette="gray" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </Button>
        </Flex>
      </Flex>
      {show && (
        <Box p={5}>
          <Flex gap={4} mb={4} flexWrap="wrap">
            <Badge colorPalette="brand">Record #{execution.recordNumber}</Badge>
            <Badge colorPalette="gray">Engine: {execution.connectionEngine}</Badge>
            <Badge colorPalette="gray">{execution.executedAt}</Badge>
            <Badge variant="outline" color={execution.success ? 'status.ok' : 'status.bad'} borderColor={execution.success ? 'status.ok' : 'status.bad'}>{execution.success ? 'SUCCESS' : 'FAILED'}</Badge>
          </Flex>
          <Box as="pre" fontSize="xs" color="status.ok" bg="bg.canvas" p={4} borderRadius="lg"
            overflowX="auto" fontFamily="mono" whiteSpace="pre-wrap" lineHeight="tall">
            {execution.stats.rawOutput}
          </Box>
          {execution.recordNumber && (
            <Text fontSize="xs" color="fg.muted" mt={3}>📁 Audit log saved</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutePage() {
  const api = useApi();
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [runs, setRuns] = useState(1);
  const [kind, setKind] = useState<'procedure' | 'batch'>('batch');
  const [original, setOriginal] = useState<TargetDraft>(emptyDraft());
  const [optimized, setOptimized] = useState<TargetDraft>(emptyDraft());
  const [engine, setEngine] = useState<'simulation' | 'mssql' | 'postgres'>('simulation');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('1433');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [trustCert, setTrustCert] = useState(true);

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testInfo, setTestInfo] = useState<TestInfo | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [usedParams, setUsedParams] = useState<ExecParam[]>([]);
  const [submittedSql, setSubmittedSql] = useState<{ original: string; optimized: string } | null>(null);
  const [ranSource, setRanSource] = useState<{ source: RefactorSource; engine: typeof engine; connection: Record<string, unknown> } | null>(null);
  // UX-1: the first problem in the inputs, shown next to the Execute button and used to block the run.
  const inputProblem = (kind === 'procedure' && !isDraftEmpty(kind, original) && targetError(kind, original))
    || (mode === 'compare' && kind === 'procedure' && !isDraftEmpty(kind, optimized) && targetError(kind, optimized))
    || null;
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'compare' | 'original' | 'optimized'>('compare');
  const abortRef = useRef<AbortController | null>(null);

  const [portError, setPortError] = useState<string | null>(null);

  /** Returns false (and sets a field error) when the port is not an integer in 1-65535. */
  function validatePort(): boolean {
    const n = Number(port);
    if (port.trim() === '' || !Number.isInteger(n) || n < 1 || n > 65535) {
      setPortError('Port must be a whole number between 1 and 65535');
      return false;
    }
    setPortError(null);
    return true;
  }

  // UX-2: the parameters of the named procedure, read from the database into the rows.
  const [loadNote, setLoadNote] = useState<{ original: string | null; optimized: string | null }>({ original: null, optimized: null });
  const loadParams = async (which: 'original' | 'optimized') => {
    const draft = which === 'original' ? original : optimized;
    const set = which === 'original' ? setOriginal : setOptimized;
    const res = await api<{ parameters: { name: string; type: ParamType | null; isOutput: boolean; supported: boolean }[] }>(
      '/api/execute/parameters',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, name: draft.name.trim(), connection: connection() }),
      },
      'Could not read the parameters',
    );
    if (!res.ok || !res.data) {
      setLoadNote((n) => ({ ...n, [which]: res.error ?? 'Could not read the parameters' }));
      return;
    }
    const found = res.data.parameters;
    const skipped = found.filter((p) => !p.supported).map((p) => p.name);
    set({
      ...draft,
      params: found.map((p) => ({ ...newParamRow(), name: p.name, type: p.type ?? 'nvarchar', output: p.isOutput })),
    });
    setLoadNote((n) => ({
      ...n,
      [which]: skipped.length ? `Loaded ${found.length}. These types are not supported in the editor, so set them by hand: ${skipped.join(', ')}` : null,
    }));
  };

  // UX-3: named parameter sets per procedure, kept in this browser only.
  const [paramStore, setParamStore] = useState<ParamSetStore>({});
  useEffect(() => {
    // Read after mount: browser storage is not available during the server render, so reading it earlier would mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setParamStore(readParamSets(window.localStorage)); } catch { /* storage blocked */ }
  }, []);
  const draftOf = (which: 'original' | 'optimized') => (which === 'original' ? original : optimized);
  const setDraftOf = (which: 'original' | 'optimized') => (which === 'original' ? setOriginal : setOptimized);
  const saveSet = (which: 'original' | 'optimized', setName: string) => {
    const d = draftOf(which);
    const rows: SavedParam[] = d.params.map((p) => ({ name: p.name, type: p.type, value: p.value, isNull: p.isNull, output: p.output }));
    const next = withSet(paramStore, d.name.trim(), setName, rows);
    const ok = writeParamSets(window.localStorage, next);
    setParamStore(next);
    setLoadNote((n) => ({ ...n, [which]: ok ? `Saved set “${setName}” in this browser.` : 'Could not save the set in this browser (storage is full or blocked).' }));
  };
  const loadSet = (which: 'original' | 'optimized', setName: string) => {
    const d = draftOf(which);
    const saved = paramStore[d.name.trim()]?.[setName] ?? [];
    setDraftOf(which)({ ...d, params: saved.map((p) => ({ ...newParamRow(), ...p, type: p.type as ParamType })) });
    setLoadNote((n) => ({ ...n, [which]: `Loaded set “${setName}”.` }));
  };
  const deleteSet = (which: 'original' | 'optimized', setName: string) => {
    const d = draftOf(which);
    const next = withoutSet(paramStore, d.name.trim(), setName);
    writeParamSets(window.localStorage, next);
    setParamStore(next);
    setLoadNote((n) => ({ ...n, [which]: `Deleted set “${setName}”.` }));
  };

  const connection = () => ({
    host, port: Number(port), database, username, password,
    ...(engine === 'mssql' ? { trustServerCertificate: trustCert } : {}),
  });

  async function handleTest() {
    if (engine === 'simulation') return;
    if (!validatePort()) return;
    setTesting(true);
    setTestInfo(null);
    const res = await api<{ serverVersion?: string }>(
      '/api/connections/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, connection: connection() }),
      },
      'Connection test failed'
    );
    if (res.ok) {
      setTestInfo({ ok: true, message: `Connected${res.data?.serverVersion ? `: ${res.data.serverVersion}` : ''}` });
    } else if (res.status !== 401) {
      setTestInfo({ ok: false, message: res.error ?? 'Connection test failed' });
    }
    setTesting(false);
  }

  /** RF-6: a refactored batch goes into the Optimized editor; nothing runs until Execute is pressed. */
  function useAsOptimized(sql: string) {
    setMode('compare');
    setKind('batch');
    setOptimized({ ...emptyDraft(), sql });
    setResult(null);
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleExecute() {
    if (isDraftEmpty(kind, original)) return;
    if (engine !== 'simulation' && !validatePort()) return;
    const orig = buildTarget(kind, original);
    if (!orig.ok) { setError(orig.error); return; }
    let opt: ReturnType<typeof buildTarget> | null = null;
    if (mode === 'compare') {
      opt = buildTarget(kind, optimized);
      if (!opt.ok) { setError(opt.error); return; }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    setUsedParams(orig.target.kind === 'procedure' ? orig.target.params : []);
    // RF-2: the refactor panel works on what was run, on the server it ran on, even if the form changes afterwards.
    setRanSource({
      source: orig.target.kind === 'batch' ? { kind: 'batch', sql: orig.target.sql } : { kind: 'procedure', name: orig.target.name },
      engine,
      connection: engine !== 'simulation' ? connection() : {},
    });
    const textOf = (d: TargetDraft) => kind === 'batch'
      ? d.sql
      : `${d.name}\n${d.params.map((p) => `  ${p.name} ${p.type} = ${p.isNull ? 'NULL' : p.value}`).join('\n')}`;
    setSubmittedSql({ original: textOf(original), optimized: textOf(optimized) });

    const res = await api<{ result: ExecuteResult }>(
      '/api/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          engine,
          ...(engine !== 'simulation' ? { connection: connection() } : {}),
          original: orig.target,
          ...(opt && opt.ok ? { optimized: opt.target } : {}),
          ...(mode === 'single' && runs > 1 ? { runs } : {}),
        }),
      },
      'Execution failed'
    );
    abortRef.current = null;
    if (res.ok && res.data) {
      setResult(res.data.result);
    } else if (controller.signal.aborted) {
      setError('Execution cancelled');
    } else if (res.status !== 401) {
      setError(res.error ?? 'Execution failed');
    }
    setLoading(false);
  }

  return (
    <Box color="fg.default">
      <Container maxW="container.xl" p={0}>

        {/* Header */}
        <header className="page-header">
          <div>
            <p className="page-kicker">Execution</p>
            <h2 className="page-title">Execute & Audit SP</h2>
            <p className="analysis-note">Execute Stored Procedures, collect full IO/Statistical metrics, store audit logs, and get deep R004 performance analysis.</p>
          </div>
        </header>

        {/* Mode toggle */}
        <Flex gap={3} mb={6}>
          <Button
            size="sm" colorPalette="brand"
            variant={mode === 'single' ? 'solid' : 'outline'}
            onClick={() => setMode('single')}
          >
            Single SP
          </Button>
          <Button
            size="sm" colorPalette="brand"
            variant={mode === 'compare' ? 'solid' : 'outline'}
            onClick={() => setMode('compare')}
          >
            Compare Original vs Optimized
          </Button>
          {mode === 'single' && (
            <Flex align="center" gap={2}>
              <Text fontSize="xs" color="fg.muted">Runs</Text>
              <Input
                size="xs" type="number" min={1} max={20} w="72px" value={runs} aria-label="Runs"
                onChange={(e) => setRuns(Math.min(20, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
                bg="bg.canvas" borderColor="border.subtle" color="fg.default"
              />
              <Text fontSize="xs" color="fg.muted">1 = one run; more adds a warm-up and summary</Text>
            </Flex>
          )}
        </Flex>

        {/* Target kind toggle */}
        <Flex gap={3} mb={6} role="group" aria-label="Target kind">
          <Button size="sm" colorPalette="brand" variant={kind === 'procedure' ? 'solid' : 'outline'}
            aria-pressed={kind === 'procedure'} onClick={() => setKind('procedure')}>
            Procedure
          </Button>
          <Button size="sm" colorPalette="brand" variant={kind === 'batch' ? 'solid' : 'outline'}
            aria-pressed={kind === 'batch'} onClick={() => setKind('batch')}>
            Batch
          </Button>
        </Flex>

        {/* Connection Config */}
        <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6} mb={6}>
          <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={4} textTransform="uppercase" letterSpacing="wider">
            🔌 Database Connection
          </Text>
          <Grid templateColumns={{ base: '1fr', md: 'repeat(3, 1fr)' }} gap={4}>
            <Box>
              <Text fontSize="xs" color="fg.muted" mb={1}>Engine</Text>
              <select
                value={engine}
                onChange={(e) =>
                  setEngine(e.target.value as 'simulation' | 'mssql' | 'postgres')
                }
                className="w-full rounded-md border border-[var(--panel-border)] bg-[var(--panel-strong)] px-3 py-2 text-[var(--text)] outline-none ring-0 focus:border-[var(--accent-default)]"
              >
                <option value="simulation">🧪 Simulation (no DB needed)</option>
                <option value="mssql">🗄 SQL Server (mssql)</option>
                <option value="postgres">🐘 PostgreSQL (pg)</option>
              </select>
            </Box>

            {engine !== 'simulation' && (
              <>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Host</Text>
                  <Input size="sm" value={host} onChange={e => setHost(e.target.value)} bg="bg.raised" borderColor="border.subtle" color="fg.default" placeholder="localhost" />
                </Box>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Port</Text>
                  <Input size="sm" value={port} onChange={e => setPort(e.target.value)} bg="bg.raised" borderColor="border.subtle" color="fg.default" placeholder="1433" aria-label="Port" aria-invalid={portError !== null} />
                  {portError && <Text fontSize="xs" color="status.bad" mt={1} role="alert">{portError}</Text>}
                </Box>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Database</Text>
                  <Input size="sm" value={database} onChange={e => setDatabase(e.target.value)} bg="bg.raised" borderColor="border.subtle" color="fg.default" placeholder="MyDatabase" />
                </Box>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Username</Text>
                  <Input size="sm" value={username} onChange={e => setUsername(e.target.value)} bg="bg.raised" borderColor="border.subtle" color="fg.default" placeholder="sa" />
                </Box>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>Password</Text>
                  <Box position="relative">
                    <Input size="sm" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} bg="bg.raised" borderColor="border.subtle" color="fg.default" placeholder="••••••••" pr={9} />
                    <Button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      position="absolute"
                      right={1}
                      top="50%"
                      transform="translateY(-50%)"
                      size="xs"
                      variant="ghost"
                      colorPalette="gray"
                      px={1}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                        {showPassword && <line x1="3" y1="3" x2="21" y2="21" />}
                      </svg>
                    </Button>
                  </Box>
                </Box>
                {engine === 'mssql' && (
                  <Flex align="center" gap={3} pt={4}>
                    <input
                      type="checkbox"
                      checked={trustCert}
                      onChange={(e) => setTrustCert(e.target.checked)}
                      className="h-4 w-4 rounded border-[var(--panel-border)] bg-[var(--panel-strong)] text-[var(--accent-default)]"
                    />
                    <Text fontSize="xs" color="fg.muted">Trust Server Certificate</Text>
                  </Flex>
                )}
              </>
            )}
          </Grid>
          {engine !== 'simulation' && (
            <Flex mt={4} gap={3} align="center">
              <Button size="sm" variant="outline" colorPalette="brand" onClick={handleTest}
                loading={testing} loadingText="Testing..." disabled={testing || !host.trim() || !database.trim()}>
                Test connection
              </Button>
              {testInfo && (
                <Text fontSize="sm" role="status" color={testInfo.ok ? 'status.ok' : 'status.bad'}>{testInfo.message}</Text>
              )}
            </Flex>
          )}
          {engine === 'simulation' && (
            <Box mt={4} p={3} bg="bg.raised" borderRadius="lg" borderWidth="1px" borderColor="accent.default">
              <Text fontSize="sm" color="accent.default">
                🧪 <strong>Simulation Mode:</strong> Generates realistic SQL Server statistical output based on SP pattern analysis. No database connection required.
              </Text>
            </Box>
          )}
        </Box>

        {/* SP Input */}
        <Grid templateColumns={mode === 'compare' ? '1fr 1fr' : '1fr'} gap={5} mb={6}>
          <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
            <Flex align="center" gap={2} mb={3}>
              {mode === 'compare' && <Badge variant="outline" color="accent.default" borderColor="accent.default">ORIGINAL</Badge>}
              <Text fontSize="sm" fontWeight="semibold" color="fg.default" textTransform="uppercase" letterSpacing="wider">
                {mode === 'compare' ? 'Current SP' : 'Stored Procedure'}
              </Text>
            </Flex>
            <TargetEditor
              kind={kind} draft={original} onChange={setOriginal} color="fg.default"
              placeholder="-- Paste your Stored Procedure here..."
              onLoadParams={engine === 'mssql' ? () => void loadParams('original') : undefined}
              loadNote={loadNote.original}
              setNames={setNamesFor(paramStore, original.name.trim())}
              onSaveSet={(n) => saveSet('original', n)}
              onLoadSet={(n) => loadSet('original', n)}
              onDeleteSet={(n) => deleteSet('original', n)}
            />
          </Box>

          {mode === 'compare' && (
            <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
              <Flex align="center" gap={2} mb={3}>
                <Badge variant="outline" color="status.ok" borderColor="status.ok">OPTIMIZED</Badge>
                <Text fontSize="sm" fontWeight="semibold" color="fg.default" textTransform="uppercase" letterSpacing="wider">Optimized SP</Text>
              </Flex>
              <TargetEditor
                kind={kind} draft={optimized} onChange={setOptimized} color="fg.default"
                placeholder="-- Paste your Optimized SP here..."
                onLoadParams={engine === 'mssql' ? () => void loadParams('optimized') : undefined}
                loadNote={loadNote.optimized}
                setNames={setNamesFor(paramStore, optimized.name.trim())}
                onSaveSet={(n) => saveSet('optimized', n)}
                onLoadSet={(n) => loadSet('optimized', n)}
                onDeleteSet={(n) => deleteSet('optimized', n)}
              />
            </Box>
          )}
        </Grid>

        {/* Execute button */}
        <Flex justify="flex-end" gap={3} mb={8}>
          {loading && (
            <Button size="lg" variant="outline" color="status.bad" borderColor="status.bad" onClick={handleCancel}>Cancel</Button>
          )}
          <Button
            colorPalette="brand"
            size="lg"
            px={10}
            onClick={handleExecute}
            loading={loading}
            loadingText="Executing..."
            disabled={isDraftEmpty(kind, original) || (mode === 'compare' && isDraftEmpty(kind, optimized)) || !!inputProblem || loading}
          >
            ▶ Execute & Audit
          </Button>
          {inputProblem && (
            <Text fontSize="sm" color="status.bad" w="100%" textAlign="right">Fix before running: {inputProblem}</Text>
          )}
        </Flex>

        {/* Loading */}
        {loading && (
          <Flex justify="center" align="center" py={16} gap={4} direction="column" role="status">
            <Spinner size="xl" color="status.warn" borderWidth="3px" />
            <Text color="fg.muted">
              Executing SP{mode === 'compare' ? 's' : ''} and collecting STATISTICS IO / TIME data...
            </Text>
          </Flex>
        )}

        {/* Error */}
        {error && (
          <Box bg="bg.raised" borderWidth="1px" borderColor="status.bad" borderRadius="xl" p={5} mb={6} role="alert">
            <Text color="status.bad" fontWeight="semibold">⚠️ Execution Failed</Text>
            <Text color="status.bad" fontSize="sm" mt={1}>{error}</Text>
          </Box>
        )}

        {/* Results */}
        {result && !loading && (
          <Box display="flex" flexDirection="column" gap={6}>
            {result.warnings && result.warnings.length > 0 && (
              <Box bg="bg.raised" borderWidth="1px" borderColor="status.warn" borderRadius="xl" p={4} role="status">
                <Text color="status.warn" fontWeight="semibold" fontSize="sm">Warnings</Text>
                {result.warnings.map((w, i) => <Text key={i} color="fg.default" fontSize="sm">{w}</Text>)}
              </Box>
            )}
            {(result.simulated ??
              (result.mode === 'single' ? result.execution.stats.simulated : result.original.execution.stats.simulated)) && (
              <Box><Badge variant="outline" color="status.warn" borderColor="status.warn">Simulated</Badge></Box>
            )}

            {result.mode === 'single' ? (
              <>
                <AnalysisPanel analysis={result.analysis} title={`📊 Execution Analysis — ${result.execution.spLabel}`} params={usedParams} outputs={result.execution.outputs} />
                <RawStatsPanel execution={result.execution} />
                {result.execution.success && ranSource && (
                  <RefactorPanel
                    key={result.execution.recordNumber}
                    source={ranSource.source} engine={ranSource.engine} connection={ranSource.connection}
                    analysis={result.analysis} onUseAsOptimized={useAsOptimized}
                  />
                )}
              </>
            ) : (
              <>
                {/* Comparison improvement strip */}
                {result.comparison.improvementPercent != null && (
                  <Box p={5} borderRadius="xl" borderWidth="1px"
                    bg={result.comparison.improvementPercent > 0 ? 'bg.raised' : 'bg.raised'}
                    borderColor={result.comparison.improvementPercent > 0 ? 'status.ok' : 'status.bad'}>
                    <Flex align="center" gap={4}>
                      <Box fontSize="3xl">{result.comparison.improvementPercent > 20 ? '🚀' : result.comparison.improvementPercent > 0 ? '📈' : '📉'}</Box>
                      <Box>
                        <Text fontWeight="bold" color={result.comparison.improvementPercent > 0 ? 'status.ok' : 'status.bad'} fontSize="lg">
                          {result.comparison.improvementPercent > 0
                            ? `${result.comparison.improvementPercent}% I/O Improvement`
                            : `${Math.abs(result.comparison.improvementPercent)}% I/O Regression`}
                        </Text>
                        <Text color="fg.muted" fontSize="sm">{result.comparison.comparisonSummary}</Text>
                      </Box>
                    </Flex>
                  </Box>
                )}

                {/* Tabs */}
                <Flex gap={2}>
                  {(['compare', 'original', 'optimized'] as const).map(tab => (
                    <Button key={tab} size="sm"
                      variant={activeTab === tab ? 'solid' : 'outline'}
                      colorPalette="brand"
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab === 'compare' ? '📊 Comparison' : tab === 'original' ? '🔴 Original' : '🟢 Optimized'}
                    </Button>
                  ))}
                </Flex>

                {activeTab === 'compare' && submittedSql && (
                  <OptimizedPanel
                    original={result.original.analysis} optimized={result.optimized.analysis}
                    originalText={submittedSql.original} optimizedText={submittedSql.optimized}
                  />
                )}
                {activeTab === 'compare' && <AnalysisPanel analysis={result.comparison} title="📊 Comparative Audit" />}
                {activeTab === 'original' && (
                  <>
                    <AnalysisPanel analysis={result.original.analysis} title="🔴 Original SP Audit" outputs={result.original.execution.outputs} />
                    <RawStatsPanel execution={result.original.execution} />
                  </>
                )}
                {activeTab === 'optimized' && (
                  <>
                    <AnalysisPanel analysis={result.optimized.analysis} title="🟢 Optimized SP Audit" outputs={result.optimized.execution.outputs} />
                    <RawStatsPanel execution={result.optimized.execution} />
                  </>
                )}
              </>
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
