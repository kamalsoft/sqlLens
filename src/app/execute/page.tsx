'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Box, Container, Heading, Text, Button, Flex,
  Spinner, Badge, Grid, Separator, Tabs,
} from '@chakra-ui/react';
import { GRADE_RULES, STANDARD_RECOMMENDATIONS, type AuditAnalysis, type Grade, type PlanFinding, type ProdVerdict } from '@/lib/audit-analyzer';
import type { ExecParam } from '@/components/execute/target-editor';
import type { ExecutionResult } from '@/lib/sp-executor';
import { useApi } from '@/components/api-client';
import { gradeToken, VERDICT_TONE, verdictTone } from '@/lib/status-tone';
import { RefactorPanel, type RefactorSource } from '@/components/execute/refactor-panel';
import type { RefactorResponse } from '@/components/refactor/RefactorResultView';
import { useLeaveGuard } from '@/components/leave-guard';
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

/** EX-5: the run's outcome in one line, above the result tabs. */
function VerdictBar({ analysis }: { analysis: AuditAnalysis }) {
  const v = analysis.prodVerdict;
  const tone = v ? verdictTone(v.verdict) : null;
  const ms = analysis.timeAnalysis.totalMs;
  const reads = analysis.ioAnalysis.totalLogicalReads;
  return (
    <Flex aria-label="Result at a glance" wrap="wrap" align="center" gap={{ base: 2, md: 5 }} p={4} bg="bg.panel"
      borderWidth="1px" borderColor="border.subtle" borderRadius="xl">
      {v && tone && (
        <Text fontWeight="bold" color={tone.token}><span aria-hidden="true">{tone.symbol} </span>{v.verdict}</Text>
      )}
      <Text color={gradeToken(analysis.performanceGrade)} fontWeight="semibold">
        {analysis.performanceGrade ? `Grade ${analysis.performanceGrade}` : 'Not graded'}
      </Text>
      <Text color="fg.default">{ms === null ? 'Time not captured' : `${ms.toLocaleString()} ms`}</Text>
      <Text color="fg.default">{reads === null ? 'Reads not captured' : `${reads.toLocaleString()} logical reads`}</Text>
    </Flex>
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
        <Heading size="sm" color="accent.default">Recommendations</Heading>
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
      <Heading size="sm" color="status.ok" mb={4}>Original vs Optimized</Heading>
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

/** `part`: the Summary tab shows the verdict and key numbers, the Details tab the evidence behind them. */
function AnalysisPanel({ analysis, title, params, outputs, part = 'all' }: {
  analysis: AuditAnalysis; title: string; params?: ExecParam[]; outputs?: Record<string, unknown>;
  part?: 'summary' | 'recommendations' | 'details' | 'all';
}) {
  const summary = part === 'summary' || part === 'all';
  const recommendations = part === 'recommendations' || part === 'all';
  const details = part === 'details' || part === 'all';
  // The Summary tab shows only the first few; the Recommendations tab has them all.
  const top = [...new Set([
    ...(analysis.planFindings ?? []).map((f) => f.recommendation),
    ...analysis.recommendations.filter((r) => !STANDARD_RECOMMENDATIONS.includes(r)),
  ])].slice(0, 3);
  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="xl" overflow="hidden">
      <Box bg="bg.raised" px={6} py={4} borderBottomWidth="1px" borderColor="border.subtle">
        <Flex align="center" gap={4}>
          {summary && <GradeBadge grade={analysis.performanceGrade} />}
          <Box>
            <Heading size="md" color="fg.default">{title}</Heading>
            <Text fontSize="sm" color="fg.muted">{analysis.gradeRationale}</Text>
          </Box>
        </Flex>
        {summary && (
          <details className="connect-more grade-help">
            <summary>How is the grade worked out?</summary>
            <GradeLegend current={analysis.performanceGrade} />
          </details>
        )}
      </Box>

      <Box px={6} py={6} display="flex" flexDirection="column" gap={6}>
        {summary && (<>
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
            <Text color="fg.muted" fontSize="xs" mt={1}>
              The first run warms up the server&apos;s cache and plan, so it is not counted. The median is the typical run; p95 is close to the slowest.
            </Text>
          </Box>
        )}

        {part === 'summary' && top.length > 0 && (
          <Box aria-label="Top recommendations">
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={2} textTransform="uppercase" letterSpacing="wider">Top recommendations</Text>
            <Box as="ol" pl={5} display="flex" flexDirection="column" gap={1}>
              {top.map((r) => <Box as="li" key={r} color="fg.default" fontSize="sm">{r}</Box>)}
            </Box>
            <Text fontSize="xs" color="fg.muted" mt={2}>The Recommendations tab lists them all, by priority.</Text>
          </Box>
        )}
        </>)}

        {recommendations && <RecommendationsPanel analysis={analysis} />}

        {details && (<>
        {/* Row counts for the real tables the run read (D-039) */}
        {analysis.ioAnalysis.rowCounts && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Row counts (tables read)</Text>
            <Grid templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap={3}>
              {Object.entries(analysis.ioAnalysis.rowCounts).map(([table, rows]) => (
                <StatCard key={table} label={table} value={rows} color={rows === 0 ? 'status.bad' : 'accent.default'} />
              ))}
            </Grid>
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
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={1} textTransform="uppercase" letterSpacing="wider">OUTPUT parameters</Text>
            <Text fontSize="xs" color="fg.muted" mb={3}>Values the procedure handed back through its OUTPUT parameters.</Text>
            <Box as="pre" fontSize="xs" color="accent.default" bg="bg.canvas" p={3} borderRadius="lg" overflowX="auto" fontFamily="mono">
              {JSON.stringify(outputs, null, 2)}
            </Box>
          </Box>
        )}

        {/* Time breakdown */}
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Time Analysis</Text>
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
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Costliest plan operators</Text>
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
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Hot Tables (I/O)</Text>
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
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Pros</Text>
            {analysis.prosAndCons.pros.map((p, i) => (
              <Flex key={i} gap={2} mb={2} align="flex-start">
                <Text color="status.ok">+</Text>
                <Text color="fg.default" fontSize="sm">{p}</Text>
              </Flex>
            ))}
          </Box>
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="fg.default" mb={3} textTransform="uppercase" letterSpacing="wider">Cons</Text>
            {analysis.prosAndCons.cons.map((c, i) => (
              <Flex key={i} gap={2} mb={2} align="flex-start">
                <Text color="status.bad">−</Text>
                <Text color="fg.default" fontSize="sm">{c}</Text>
              </Flex>
            ))}
          </Box>
        </Grid>
        </>)}
      </Box>
    </Box>
  );
}

function RawStatsPanel({ execution, defaultOpen = false, label }: { execution: ExecutionResult; defaultOpen?: boolean; label?: string }) {
  const [show, setShow] = useState(defaultOpen);
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
          <Text fontSize="sm" fontWeight="semibold" color="fg.default">{label ? `${label}: raw execution output` : 'Raw execution output'}</Text>
          <Text fontSize="xs" color="fg.muted">The server&apos;s messages for this run: the STATISTICS IO and TIME lines and the plan XML. Every number on this page is parsed from this text.</Text>
        </Box>
        <Flex gap={2} align="center">
          <Button size="xs" variant="outline" colorPalette="brand" aria-label={label ? `Copy ${label.toLowerCase()} raw output` : 'Copy raw output'} onClick={copyRaw} disabled={!raw}>
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
            <Text fontSize="xs" color="fg.muted" mt={3}>Saved to the audit log as record #{execution.recordNumber}.</Text>
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
  const [kind, setKind] = useState<'procedure' | 'batch'>('procedure');
  const [original, setOriginal] = useState<TargetDraft>(emptyDraft());
  const [optimized, setOptimized] = useState<TargetDraft>(emptyDraft());
  // PG-1: SQL Server first and selected; PostgreSQL is no longer offered here.
  const [engine, setEngine] = useState<'simulation' | 'mssql'>('mssql');
  // SEC-T5: whether Settings allows real runs; null until known.
  const [liveAllowed, setLiveAllowed] = useState<boolean | null>(null);
  // P9-01: SQL Server login type; Windows logs in with NTLM as DOMAIN\\user.
  const [authType, setAuthType] = useState<'sql' | 'windows'>('sql');
  const [domain, setDomain] = useState('');
  // DB-1: databases the login can open, once loaded; null until then.
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [dbNote, setDbNote] = useState<string | null>(null);
  // The stored procedures of the chosen database, for the procedure name list; null until loaded.
  const [procedures, setProcedures] = useState<string[] | null>(null);
  const [loadingProcs, setLoadingProcs] = useState(false);
  const [procNote, setProcNote] = useState<string | null>(null);
  // Only the latest procedure list request may update the list (a slower, older reply is dropped).
  const procRequest = useRef(0);
  // EX-2: after Connect and choosing a database, the form folds to one summary line.
  const [editingConn, setEditingConn] = useState(true);
  // After a successful run, steps 1-3 fold to one bar so the results start near the top.
  const [setupFolded, setSetupFolded] = useState(false);
  // A run reopened from Audit (/execute?record=<id>): its saved result and refactor, read-only.
  const [savedRun, setSavedRun] = useState<{ id: string; recordNumber: number | null; createdAt: string; summary: string } | null>(null);
  const [savedRefactor, setSavedRefactor] = useState<{ response: RefactorResponse; id: string; recordNumber: number | null } | null>(null);
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('1433');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [trustCert, setTrustCert] = useState(true);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  // AD-2: the audit record of the last run, so a refactor made from it is linked to it.
  const [resultAuditId, setResultAuditId] = useState<string | null>(null);
  const [usedParams, setUsedParams] = useState<ExecParam[]>([]);
  const [submittedSql, setSubmittedSql] = useState<{ original: string; optimized: string } | null>(null);
  const [ranSource, setRanSource] = useState<{ source: RefactorSource; engine: typeof engine; connection: Record<string, unknown> } | null>(null);
  // UX-1: the first problem in the inputs, shown next to the Execute button and used to block the run.
  const inputProblem = (kind === 'procedure' && !isDraftEmpty(kind, original) && targetError(kind, original))
    || (mode === 'compare' && kind === 'procedure' && !isDraftEmpty(kind, optimized) && targetError(kind, optimized))
    || null;
  const [error, setError] = useState<string | null>(null);
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
    ...(engine === 'mssql' && authType === 'windows' ? { authType, domain: domain.trim() } : {}),
  });

  // EX-2: the connection folds to one line once a SQL Server database has been chosen from the list.
  const connFolded = engine === 'mssql' && !editingConn && databases !== null && databases.length > 0;
  // EX-4: why Execute is not available yet, in words.
  const runBlocker =
    engine === 'mssql' && !database.trim() ? 'Connect and choose a database first.'
    : isDraftEmpty(kind, original) ? (kind === 'procedure' ? 'Enter the stored procedure name.' : 'Paste the SQL to run.')
    : mode === 'compare' && isDraftEmpty(kind, optimized) ? 'Enter the optimized version too.'
    : inputProblem ? `Fix before running: ${inputProblem}`
    : null;

  const liveMessage = loading ? 'Running. Collecting the I/O and time statistics.'
    : error ? `Execution failed: ${error}`
    : result ? `Run finished. ${result.mode === 'single' ? (result.analysis.prodVerdict?.verdict ?? '') : 'Comparison ready.'}`.trim()
    : '';

  /** A different server or login has a different list: drop the loaded one. */
  function changeLogin(apply: () => void) {
    apply();
    setDatabases(null);
    setDbNote(null);
    setProcedures(null);
    setProcNote(null);
    procRequest.current++;
  }

  /** Lists the stored procedures of `db` (the chosen database), for the procedure name field. */
  async function loadProcedures(db = database) {
    if (engine !== 'mssql' || !db.trim()) return;
    const request = ++procRequest.current;
    setLoadingProcs(true);
    setProcNote(null);
    const res = await api<{ procedures?: string[] }>(
      '/api/execute/procedures',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine, connection: { ...connection(), database: db } }) },
      'Could not list the stored procedures',
    );
    if (request !== procRequest.current) return;
    if (res.ok) {
      const list = res.data?.procedures ?? [];
      setProcedures(list);
      if (list.length === 0) setProcNote('No stored procedures in this database.');
    } else if (res.status !== 401) {
      setProcNote(res.error ?? 'Could not list the stored procedures');
    }
    setLoadingProcs(false);
  }

  async function loadDatabases() {
    if (!validatePort()) return;
    setLoadingDbs(true);
    setDbNote(null);
    const res = await api<{ databases?: string[] }>(
      '/api/execute/databases',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine, connection: connection() }) },
      'Could not list the databases',
    );
    if (res.ok) {
      const list = res.data?.databases ?? [];
      setDatabases(list);
      if (list.length === 0) setDbNote('This login cannot open any database.');
      else {
        setEditingConn(false);
        if (list.includes(database)) void loadProcedures(database);
        else setDatabase('');
        // The form folds and its Connect button goes away: hand keyboard focus to the next choice.
        requestAnimationFrame(() => document.getElementById('exec-database')?.focus());
      }
    } else if (res.status !== 401) {
      setDbNote(res.error ?? 'Could not list the databases');
    }
    setLoadingDbs(false);
  }

  useEffect(() => {
    let cancelled = false;
    void api<{ allowLiveExecution?: boolean }>('/api/appconfig', { cache: 'no-store' }).then((res) => {
      if (!cancelled && res.ok) setLiveAllowed(res.data?.allowLiveExecution === true);
    });
    return () => { cancelled = true; };
  }, [api]);

  // Reopen a saved run from Audit: /execute?record=<id> shows its result and its latest refactor as they were.
  useEffect(() => {
    const recordId = new URLSearchParams(window.location.search).get('record');
    if (!recordId) return;
    let cancelled = false;
    type Saved = {
      id: string; type: string; createdAt: string; recordNumber: number | null; modelId: string | null; engine: string | null;
      request: { mode?: string; engine?: string; database?: string; original?: { kind: string; name?: string; sql?: string; params?: unknown[] } };
      response: unknown; related?: { refactors: { id: string; recordNumber: number | null }[] };
    };
    void (async () => {
      const res = await api<Saved>(`/api/audit/${encodeURIComponent(recordId)}`, { cache: 'no-store' }, 'Unable to load the saved run');
      if (cancelled) return;
      if (!res.ok || !res.data) {
        if (res.status !== 401) setError(res.status === 404 ? 'That saved run was not found.' : (res.error ?? 'Unable to load the saved run'));
        return;
      }
      const run = res.data;
      if (run.type !== 'EXECUTE' && run.type !== 'EXECUTE_COMPARE') {
        setError('That audit record is not a run of Execute & Audit SP.');
        return;
      }
      // Stored JSON is untrusted: the result tabs need an execution and an analysis to render.
      type Shape = { execution?: unknown; analysis?: unknown };
      const stored = run.response as (Shape & { mode?: string; original?: Shape; optimized?: Shape }) | null;
      const hasRun = (side?: Shape) => Boolean(side?.execution && side.analysis);
      const usable = stored && typeof stored === 'object' &&
        (stored.mode === 'compare' ? hasRun(stored.original) && hasRun(stored.optimized) : hasRun(stored));
      if (!usable) {
        setError('That saved run has no result that can be shown.');
        return;
      }
      const target = run.request.original;
      const engineName = run.request.engine === 'mssql' ? `SQL Server · ${run.request.database ?? ''}` : 'Simulation';
      const what = target?.kind === 'procedure' ? `${target.name} (procedure)` : 'SQL batch';
      setResult(run.response as ExecuteResult);
      setResultAuditId(run.id);
      setRanSource({
        source: target?.kind === 'procedure' ? { kind: 'procedure', name: target.name ?? '' } : { kind: 'batch', sql: target?.sql ?? '' },
        engine: run.request.engine === 'mssql' ? 'mssql' : 'simulation',
        connection: {},
      });
      setSavedRun({ id: run.id, recordNumber: run.recordNumber, createdAt: run.createdAt, summary: `${engineName} · ${what}` });
      const last = run.related?.refactors.at(-1);
      if (!last) return;
      const rf = await api<{ id: string; modelId: string | null; response: unknown }>(`/api/audit/${encodeURIComponent(last.id)}`, { cache: 'no-store' }, 'Unable to load the saved refactor');
      if (cancelled) return;
      if (!rf.ok || !rf.data) {
        if (rf.status !== 401) setError(`The refactor saved from this run (#${last.recordNumber ?? '-'}) could not be loaded.`);
      } else {
        setSavedRefactor({ response: { id: rf.data.id, model: rf.data.modelId ?? undefined, result: rf.data.response as RefactorResponse['result'] }, id: last.id, recordNumber: last.recordNumber });
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  /** Leaves a reopened saved run for a fresh form. */
  function startNewRun() {
    setSavedRun(null);
    setSavedRefactor(null);
    setResult(null);
    setResultAuditId(null);
    setError('');
    setSetupFolded(false);
    window.history.replaceState(null, '', '/execute');
  }

  /** RF-6: a refactored batch goes into the Optimized editor; nothing runs until Execute is pressed. */
  function useAsOptimized(sql: string) {
    setMode('compare');
    setKind('batch');
    setOptimized({ ...emptyDraft(), sql });
    setResult(null);
    setResultAuditId(null);
    setSetupFolded(false);
  }

  function handleCancel() {
    abortRef.current?.abort();
  }
  // UX-B: leaving while a run is in progress asks first, and cancels the run when the user agrees.
  useLeaveGuard(loading, 'An execution', handleCancel);
  // Leaving through a link inside the page skips the question; stop the run then too (it rolls back).
  useEffect(() => () => abortRef.current?.abort(), []);

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
    setResultAuditId(null);
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

    const res = await api<{ result: ExecuteResult; id?: string }>(
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
        }),
      },
      'Execution failed'
    );
    abortRef.current = null;
    if (res.ok && res.data) {
      setResult(res.data.result);
      setResultAuditId(res.data.id ?? null);
      setSetupFolded(true);
    } else if (controller.signal.aborted) {
      setSetupFolded(false);
      setError('Execution cancelled');
    } else if (res.status !== 401) {
      setSetupFolded(false);
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
            <p className="analysis-note">Run a stored procedure or SQL batch, collect its I/O and time statistics, save an audit record, and get a performance analysis.</p>
          </div>
        </header>

        {savedRun ? (
          <Box as="section" aria-label="Saved run" className="setup-bar">
            <Text color="fg.default">
              <strong>Saved run #{savedRun.recordNumber ?? '-'}</strong> · {new Date(savedRun.createdAt).toLocaleString()} · {savedRun.summary}
            </Text>
            <Flex gap={2} wrap="wrap">
              <Link href={`/audit/${savedRun.id}`} className="button button-secondary">Back to the audit record</Link>
              <Button colorPalette="brand" onClick={startNewRun}>Start a new run</Button>
            </Flex>
          </Box>
        ) : setupFolded ? (
          <Box as="section" aria-label="Run setup" className="setup-bar">
            <Text color="fg.default">
              <strong>{engine === 'mssql' ? `SQL Server · ${database}` : 'Simulation'}</strong>
              {' · '}
              {kind === 'procedure'
                ? `${original.name.trim()} (${original.params.length} parameter${original.params.length === 1 ? '' : 's'})`
                : 'SQL batch'}
              {mode === 'compare' ? ' · compared with an optimized version' : ''}
            </Text>
            <Flex gap={2} wrap="wrap">
              <Button variant="outline" colorPalette="gray" onClick={() => setSetupFolded(false)}>Edit setup</Button>
              {loading && (
                <Button variant="outline" color="status.bad" borderColor="status.bad" onClick={handleCancel}>Cancel</Button>
              )}
              <Button colorPalette="brand" onClick={handleExecute} loading={loading} loadingText="Running..." disabled={runBlocker !== null || loading}>
                Run again
              </Button>
            </Flex>
          </Box>
        ) : (<>
        {/* Connection: laid out like SQL Server's "Connect to Server" dialog. */}
        <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6} mb={6} as="section" aria-labelledby="connect-title">
          <Heading as="h3" id="connect-title" size="sm" color="fg.default" mb={connFolded ? 3 : 5}>
            <span className="step-no" aria-hidden="true">1</span>Connect to Server
          </Heading>
          {connFolded ? (
            <Flex align="center" gap={3} wrap="wrap" role="status">
              <Text color="status.ok" fontWeight="semibold"><span aria-hidden="true">✓ </span>Connected</Text>
              <Text color="fg.default">
                {host}{port.trim() && port.trim() !== '1433' ? `,${port.trim()}` : ''} ·{' '}
                {authType === 'windows' ? `Windows login ${domain}\\${username}` : `SQL login ${username}`}
                {databases ? ` · ${databases.length} database${databases.length === 1 ? '' : 's'}` : ''}
              </Text>
              <Button size="sm" variant="outline" colorPalette="gray" onClick={() => setEditingConn(true)}>Change</Button>
            </Flex>
          ) : (<>
          <div className="connect-form">
            <label htmlFor="exec-engine">Server type</label>
            <select id="exec-engine" className="select" value={engine}
              onChange={(e) => { const v = e.target.value as 'simulation' | 'mssql'; changeLogin(() => setEngine(v)); }}>
              <option value="mssql">SQL Server</option>
              <option value="simulation">Simulation (no database needed)</option>
            </select>

            {engine !== 'simulation' && (
              <>
                <label htmlFor="exec-host">Server name</label>
                <div className="connect-row">
                  <input id="exec-host" className="input" value={host} placeholder="localhost"
                    onChange={(e) => { const v = e.target.value; changeLogin(() => setHost(v)); }} />
                  <input id="exec-port" className="input connect-port" value={port} placeholder="1433" aria-label="Port" aria-invalid={portError !== null}
                    onChange={(e) => { const v = e.target.value; changeLogin(() => setPort(v)); }} />
                </div>
                {portError && <><span /><p className="connect-error" role="alert">{portError}</p></>}

                <label htmlFor="exec-auth">Authentication</label>
                <select id="exec-auth" className="select" value={authType}
                  onChange={(e) => { const v = e.target.value as 'sql' | 'windows'; changeLogin(() => setAuthType(v)); }}>
                  <option value="sql">SQL Server Authentication</option>
                  <option value="windows">Windows Authentication</option>
                </select>

                {authType === 'windows' && (
                  <>
                    <label htmlFor="exec-domain">Domain</label>
                    <input id="exec-domain" className="input" value={domain} placeholder="CORP"
                      onChange={(e) => { const v = e.target.value; changeLogin(() => setDomain(v)); }} />
                  </>
                )}

                <label htmlFor="exec-user">{authType === 'windows' ? 'User name' : 'Login'}</label>
                <input id="exec-user" className="input" value={username} placeholder={authType === 'windows' ? 'jsmith' : 'sa'} autoComplete="username"
                  onChange={(e) => { const v = e.target.value; changeLogin(() => setUsername(v)); }} />

                <label htmlFor="exec-password">Password</label>
                <div className="connect-password">
                  <input id="exec-password" className="input" type={showPassword ? 'text' : 'password'} value={password} placeholder="••••••••" autoComplete="current-password"
                    onChange={(e) => { const v = e.target.value; changeLogin(() => setPassword(v)); }} />
                  <Button
                    type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)} size="xs" variant="ghost" colorPalette="gray" px={1}
                    position="absolute" right={2} top="50%" transform="translateY(-50%)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                      {showPassword && <line x1="3" y1="3" x2="21" y2="21" />}
                    </svg>
                  </Button>
                </div>

                <span />
                <details className="connect-more">
                  <summary>More options</summary>
                  <label className="connect-check">
                  <input type="checkbox" className="checkbox" checked={trustCert}
                    onChange={(e) => { const v = e.target.checked; changeLogin(() => setTrustCert(v)); }} />
                  Trust server certificate
                  </label>
                </details>
                {authType === 'windows' && trustCert && (
                  <>
                    <span />
                    <p className="connect-warn" role="note">
                      Your Windows login will go to a server whose certificate is not checked, so a server pretending to be this one
                      could capture it. Turn this off if the server has a trusted certificate.
                    </p>
                  </>
                )}

                <span />
                <div className="connect-actions">
                  <Button colorPalette="brand" onClick={() => void loadDatabases()} loading={loadingDbs} loadingText="Connecting..."
                    disabled={loadingDbs || !host.trim() || !username.trim() || (authType === 'windows' && !domain.trim())}>
                    Connect
                  </Button>
                  {dbNote && <p className="connect-error" role="alert">{dbNote}</p>}
                </div>
              </>
            )}
          </div>
          {engine === 'simulation' && (
            <Box mt={4} p={3} bg="bg.raised" borderRadius="lg" borderWidth="1px" borderColor="accent.default">
              <Text fontSize="sm" color="accent.default">
                <strong>Simulation mode:</strong> generates realistic SQL Server statistical output based on SP pattern analysis. No database connection required.
              </Text>
            </Box>
          )}
          </>)}
        </Box>

        {/* Step 2: what to run */}
        <Box as="section" aria-labelledby="what-title" bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6} mb={6}>
          <Heading as="h3" id="what-title" size="sm" color="fg.default" mb={4}>
            <span className="step-no" aria-hidden="true">2</span>What to run
          </Heading>
          {engine === 'mssql' && (
            <div className="connect-form what-database">
              <label htmlFor="exec-database">Database</label>
              {databases && databases.length > 0 ? (
                <select id="exec-database" className="select" value={database}
                  onChange={(e) => {
                    const db = e.target.value;
                    setDatabase(db);
                    setProcedures(null);
                    setProcNote(null);
                    procRequest.current++;
                    if (db) void loadProcedures(db);
                  }}>
                  <option value="">Select a database</option>
                  {databases.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              ) : (
                <input id="exec-database" className="input" value={database} placeholder="Connect above to list databases, or type a name"
                  onChange={(e) => { setDatabase(e.target.value); setProcedures(null); setProcNote(null); procRequest.current++; }} />
              )}
            </div>
          )}
          <Flex gap={6} wrap="wrap" align="center" mb={2}>
            <fieldset className="choice-group">
              <legend className="sr-only">What to run</legend>
              <label className="choice">
                <input type="radio" name="exec-kind" checked={kind === 'procedure'} onChange={() => setKind('procedure')} /> Stored procedure
              </label>
              <label className="choice">
                <input type="radio" name="exec-kind" checked={kind === 'batch'} onChange={() => setKind('batch')} /> SQL batch
              </label>
            </fieldset>
            <label className="choice">
              <input type="checkbox" checked={mode === 'compare'} onChange={(e) => setMode(e.target.checked ? 'compare' : 'single')} />
              Compare with an optimized version
            </label>
          </Flex>
          <Text fontSize="xs" color="fg.muted" mb={4}>
            {kind === 'procedure'
              ? 'Runs a stored procedure that already exists on the server, with the parameter values you enter below.'
              : 'Runs the SQL you paste. It runs in a transaction that is rolled back afterwards, unless the script commits.'}
            {mode === 'compare' ? ' Both versions run, one after the other, and are compared.' : ''}
          </Text>
        <Grid templateColumns={{ base: '1fr', lg: mode === 'compare' ? '1fr 1fr' : '1fr' }} gap={5}>
          <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
            <Flex align="center" gap={2} mb={3}>
              {mode === 'compare' && <Badge variant="outline" color="accent.default" borderColor="accent.default">ORIGINAL</Badge>}
              <Text fontSize="sm" fontWeight="semibold" color="fg.default" textTransform="uppercase" letterSpacing="wider">
                {mode === 'compare' ? 'Current version' : kind === 'procedure' ? 'Stored procedure' : 'SQL batch'}
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
              procedures={procedures} procedureNote={procNote} loadingProcedures={loadingProcs}
              onRefreshProcedures={engine === 'mssql' && database.trim() ? () => void loadProcedures() : undefined}
            />
          </Box>

          {mode === 'compare' && (
            <Box bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={5}>
              <Flex align="center" gap={2} mb={3}>
                <Badge variant="outline" color="status.ok" borderColor="status.ok">OPTIMIZED</Badge>
                <Text fontSize="sm" fontWeight="semibold" color="fg.default" textTransform="uppercase" letterSpacing="wider">Optimized version</Text>
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
                procedures={procedures}
              />
            </Box>
          )}
        </Grid>

        </Box>

        {/* Step 3: run */}
        <Box as="section" aria-labelledby="run-title" className="run-bar" bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="xl" p={6} mb={6}>
          <Heading as="h3" id="run-title" size="sm" color="fg.default" mb={4}>
            <span className="step-no" aria-hidden="true">3</span>Run
          </Heading>
          <Flex gap={3} align="center" wrap="wrap">
            <Button
              colorPalette="brand" size="lg" px={10}
              onClick={handleExecute} loading={loading} loadingText="Running..."
              disabled={runBlocker !== null || loading}
              aria-describedby={runBlocker ? 'run-blocker' : undefined}
            >
              Execute &amp; Audit
            </Button>
            {loading && (
              <Button size="lg" variant="outline" color="status.bad" borderColor="status.bad" onClick={handleCancel}>Cancel</Button>
            )}
            {!loading && runBlocker && (
              <Text id="run-blocker" fontSize="sm" color={inputProblem ? 'status.bad' : 'fg.muted'}>{runBlocker}</Text>
            )}
          </Flex>
          {mode === 'single' && engine !== 'simulation' && (
            <Text fontSize="xs" color="fg.muted" mt={3}>
              Runs several times: a warm-up that is not counted, then the measured runs set in Settings (2 by default).
            </Text>
          )}
          {engine !== 'simulation' && liveAllowed === true && (
            <Text role="note" fontSize="sm" color="status.warn" mt={3}>
              ⚠ This runs the code for real on the server you connected to. Procedures are not rolled back and can change data:
              use a development or test database and a login with only the rights the procedure needs.
            </Text>
          )}
          {engine !== 'simulation' && liveAllowed === false && (
            <Text role="note" fontSize="sm" color="fg.muted" mt={3}>
              Live execution is off in <Link href="/settings" className="text-link">Settings</Link>, so only Simulation can run.
            </Text>
          )}
        </Box>
        </>)}

        {/* Always present, so screen readers announce what changes in it. */}
        <p className="sr-only" aria-live="polite">{liveMessage}</p>

        {/* Step 4: results */}
        {(loading || error || result) && (
          <Box as="section" aria-labelledby="results-title" mb={6}>
            <Heading as="h3" id="results-title" size="sm" color="fg.default" mb={4}>
              <span className="step-no" aria-hidden="true">4</span>Results
            </Heading>
            <div>
              {loading && (
                <Flex justify="center" align="center" py={16} gap={4} direction="column" role="status">
                  <Spinner size="xl" color="accent.default" borderWidth="3px" />
                  <Text color="fg.muted">
                    Running {mode === 'compare' ? 'both versions' : 'the SQL'} and collecting the I/O and time statistics...
                  </Text>
                </Flex>
              )}
              {error && (
                <Box bg="bg.raised" borderWidth="1px" borderColor="status.bad" borderRadius="xl" p={5} mb={6} role="alert">
                  <Text color="status.bad" fontWeight="semibold">Execution failed</Text>
                  <Text color="status.bad" fontSize="sm" mt={1}>{error}</Text>
                </Box>
              )}
            </div>

            {result && !loading && (
              <Box display="flex" flexDirection="column" gap={5}>
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
                    <VerdictBar analysis={result.analysis} />
                    <Tabs.Root key={result.execution.recordNumber} defaultValue="summary" variant="line" colorPalette="brand" lazyMount>
                      <Tabs.List aria-label="Result views">
                        <Tabs.Trigger value="summary">Summary</Tabs.Trigger>
                        <Tabs.Trigger value="recommendations">Recommendations</Tabs.Trigger>
                        <Tabs.Trigger value="details">Details</Tabs.Trigger>
                        <Tabs.Trigger value="raw">Raw output</Tabs.Trigger>
                        {result.execution.success && ranSource && <Tabs.Trigger value="refactor">Refactor</Tabs.Trigger>}
                      </Tabs.List>
                      <Tabs.Content value="summary">
                        <AnalysisPanel part="summary" analysis={result.analysis} title={`Execution Analysis — ${result.execution.spLabel}`} />
                      </Tabs.Content>
                      <Tabs.Content value="recommendations">
                        <AnalysisPanel part="recommendations" analysis={result.analysis} title={`Recommendations — ${result.execution.spLabel}`} />
                      </Tabs.Content>
                      <Tabs.Content value="details">
                        <AnalysisPanel part="details" analysis={result.analysis} title={`Details — ${result.execution.spLabel}`} params={usedParams} outputs={result.execution.outputs} />
                      </Tabs.Content>
                      <Tabs.Content value="raw">
                        <RawStatsPanel execution={result.execution} defaultOpen />
                      </Tabs.Content>
                      {result.execution.success && ranSource && (
                        <Tabs.Content value="refactor">
                          <RefactorPanel
                            key={`${result.execution.recordNumber}-${savedRefactor?.id ?? ""}`}
                            source={ranSource.source} engine={ranSource.engine} connection={ranSource.connection}
                            analysis={result.analysis} onUseAsOptimized={savedRun ? undefined : useAsOptimized} sourceAuditId={resultAuditId}
                            saved={savedRefactor} readOnly={savedRun !== null}
                          />
                        </Tabs.Content>
                      )}
                    </Tabs.Root>
                  </>
                ) : (
                  <>
                    {result.comparison.improvementPercent != null && (
                      <Box p={5} borderRadius="xl" borderWidth="1px" bg="bg.raised"
                        borderColor={result.comparison.improvementPercent > 0 ? 'status.ok' : 'status.bad'}>
                        <Text fontWeight="bold" color={result.comparison.improvementPercent > 0 ? 'status.ok' : 'status.bad'} fontSize="lg">
                          <span aria-hidden="true">{result.comparison.improvementPercent > 0 ? '▲ ' : '▼ '}</span>
                          {result.comparison.improvementPercent > 0
                            ? `${result.comparison.improvementPercent}% I/O Improvement`
                            : `${Math.abs(result.comparison.improvementPercent)}% I/O Regression`}
                        </Text>
                        <Text color="fg.muted" fontSize="sm">{result.comparison.comparisonSummary}</Text>
                      </Box>
                    )}
                    <Tabs.Root key={result.original.execution.recordNumber} defaultValue="compare" variant="line" colorPalette="brand" lazyMount>
                      <Tabs.List aria-label="Result views">
                        <Tabs.Trigger value="compare">Comparison</Tabs.Trigger>
                        <Tabs.Trigger value="original">Original</Tabs.Trigger>
                        <Tabs.Trigger value="optimized">Optimized</Tabs.Trigger>
                        <Tabs.Trigger value="raw">Raw output</Tabs.Trigger>
                      </Tabs.List>
                      <Tabs.Content value="compare">
                        <Box display="flex" flexDirection="column" gap={5}>
                          {submittedSql && (
                            <OptimizedPanel
                              original={result.original.analysis} optimized={result.optimized.analysis}
                              originalText={submittedSql.original} optimizedText={submittedSql.optimized}
                            />
                          )}
                          <AnalysisPanel analysis={result.comparison} title="Comparative Audit" />
                        </Box>
                      </Tabs.Content>
                      <Tabs.Content value="original">
                        <AnalysisPanel analysis={result.original.analysis} title="Original SP Audit" outputs={result.original.execution.outputs} />
                      </Tabs.Content>
                      <Tabs.Content value="optimized">
                        <AnalysisPanel analysis={result.optimized.analysis} title="Optimized SP Audit" outputs={result.optimized.execution.outputs} />
                      </Tabs.Content>
                      <Tabs.Content value="raw">
                        <Box display="flex" flexDirection="column" gap={5}>
                          <RawStatsPanel execution={result.original.execution} defaultOpen label="Original" />
                          <RawStatsPanel execution={result.optimized.execution} defaultOpen label="Optimized" />
                        </Box>
                      </Tabs.Content>
                    </Tabs.Root>
                  </>
                )}
              </Box>
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
