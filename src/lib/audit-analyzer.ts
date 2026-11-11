/**
 * IO/Statistical Audit Analyzer (R004)
 * Deep-dives execution stats, comparing two runs if both are provided.
 */

import type { ExecutionStats, ExecutionResult } from './sp-executor';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ProdVerdictName = 'READY' | 'OPTIMIZE' | 'INSUFFICIENT EVIDENCE' | 'UNSTABLE';
export interface ProdVerdict {
  verdict: ProdVerdictName;
  reason: string;
  /** The table or metric that drove an OPTIMIZE verdict, else null. */
  driver: string | null;
}
/** P8-02 user targets; null = not set. */
export interface Targets { maxLogicalReads: number | null; maxElapsedMs: number | null; maxScanCount: number | null }
export const NO_TARGETS: Targets = { maxLogicalReads: null, maxElapsedMs: null, maxScanCount: null };

/** P8-06: one plan operator with the runtime counters the plan recorded for it. */
export interface PlanOperator {
  nodeId: number;
  physicalOp: string;
  table: string | null;
  actualRows: number | null;
  logicalReads: number | null;
  executions: number | null;
  /** P8-07: the plan's row estimate for this operator, per execution. */
  estimatedRows: number | null;
  /** P8-07: pages written to tempdb when this operator spilled, else null. */
  spillWrites: number | null;
}

/** P8-07: a generic finding from the plan. Names are data from the run, never fixed in the code. */
export interface PlanFinding {
  kind: 'cost-concentration' | 'row-estimate' | 'tempdb-spill';
  severity: 'high' | 'medium';
  operator: string;
  table: string | null;
  message: string;
  recommendation: string;
}

/** P8-03: one measured run (the warm-up is dropped before summarising). */
export interface RunSample { elapsedMs: number | null; logicalReads: number | null }
export interface Spread { min: number; median: number; p95: number; max: number }
/** P8-03: median, p95 and spread across the measured runs. */
export interface RunSummary {
  runs: number;
  warmupRuns: number;
  elapsedMs: Spread | null;
  logicalReads: Spread | null;
  /** (max - min) / median of elapsed time, in percent; null when not measurable. */
  spreadPct: number | null;
}

export interface AuditAnalysis {
  summary: string;
  /** P8-03: null for a single run. */
  multiRun: RunSummary | null;
  /** P8-06: the costliest operators by logical reads, then rows. */
  planOperators: PlanOperator[];
  /** P8-07: generic findings from the plan. */
  planFindings: PlanFinding[];
  /** P8-02: prod-readiness verdict from evidence and user targets. */
  prodVerdict: ProdVerdict;
  /** null when no graded metric was captured. */
  performanceGrade: Grade | null;
  gradeRationale: string;
  ioAnalysis: {
    /** P8-04: row count per real table the run read (D-039); null when not counted. */
    rowCounts: Record<string, number> | null;
    totalLogicalReads: number | null;
    totalPhysicalReads: number | null;
    totalScanCount: number | null;
    hotTables: { table: string; logicalReads: number; scanCount: number; concern: string }[];
    recommendation: string;
  };
  timeAnalysis: {
    parseTimeMs: number | null;
    executeTimeMs: number | null;
    totalMs: number | null;
    classification: string;
    recommendation: string;
  };
  prosAndCons: { pros: string[]; cons: string[] };
  recommendations: string[];
  comparisonSummary?: string;
  improvementPercent?: number | null;
}

export interface MetricDelta {
  original: number | null;
  optimized: number | null;
  /** optimized - original; null if either side is null. */
  delta: number | null;
  /** (optimized - original) / original * 100; null if either side is null or original is 0. */
  deltaPct: number | null;
}

export type MetricName = 'logicalReads' | 'physicalReads' | 'scanCount' | 'cpu' | 'elapsed';
export type MetricComparison = Record<MetricName, MetricDelta>;

// ---------------------------------------------------------------------------
// Null-safe metric extraction (null = not captured, never zero)
// ---------------------------------------------------------------------------

function ioSum(stats: ExecutionStats, key: 'logicalReads' | 'physicalReads' | 'scanCount'): number | null {
  if (!stats.io || stats.io.length === 0) return null;
  return stats.io.reduce((s, r) => s + r[key], 0);
}

function metricsOf(stats: ExecutionStats): Record<MetricName, number | null> {
  return {
    logicalReads: ioSum(stats, 'logicalReads'),
    physicalReads: ioSum(stats, 'physicalReads'),
    scanCount: ioSum(stats, 'scanCount'),
    cpu: stats.executionCpu ?? null,
    elapsed: stats.totalElapsedMs ?? null,
  };
}

const fmtMs = (v: number | null): string => (v === null ? 'not captured' : `${v}ms`);
const fmtN = (v: number | null): string => (v === null ? 'not captured' : v.toLocaleString());

function delta(original: number | null, optimized: number | null): MetricDelta {
  if (original === null || optimized === null) return { original, optimized, delta: null, deltaPct: null };
  const d = optimized - original;
  return { original, optimized, delta: d, deltaPct: original === 0 ? null : (d / original) * 100 };
}

// ---------------------------------------------------------------------------
// Grade thresholds. Metrics that were not captured are skipped, not treated as 0.
// ---------------------------------------------------------------------------

/**
 * What stops a grade or READY: a real table with zero rows (D-039), or missing reads or time.
 * Returns the reason, or null when the evidence is complete.
 */
export interface EvidenceGap { reason: string; table: string | null }
/**
 * Real tables whose scans and seeks, summed over the run, returned no rows. The run then did not
 * exercise that data, whatever the timing says. Temp tables are skipped: they fill during the run.
 */
/**
 * Per real table: rows returned, executions, pages read (logical reads) and whether a seek or a scan did the reading.
 * Pages read are index and data pages; they are not rows, so a seek can read pages and still return no rows.
 */
function readCounters(stats: ExecutionStats): Map<string, { rows: number; executions: number; pages: number; seek: boolean }> {
  const byTable = new Map<string, { rows: number; executions: number; pages: number; seek: boolean }>();
  for (const o of planOperators(stats.plan)) {
    if (!o.table || o.table.startsWith('#') || !/(Scan|Seek)$/.test(o.physicalOp) || o.actualRows === null) continue;
    const t = byTable.get(o.table) ?? { rows: 0, executions: 0, pages: 0, seek: false };
    byTable.set(o.table, {
      rows: t.rows + o.actualRows,
      executions: t.executions + (o.executions ?? 0),
      pages: t.pages + (o.logicalReads ?? 0),
      seek: t.seek || /Seek$/.test(o.physicalOp),
    });
  }
  return byTable;
}

/** Tables read by a scan or seek that returned no rows, and that the run did reach. */
export function unreadTables(stats: ExecutionStats): string[] {
  return [...readCounters(stats)].filter(([, c]) => c.rows === 0 && c.executions > 0).map(([table]) => table);
}

/** Tables whose scans and seeks never executed: the run stopped before it got to them. */
export function unreachedTables(stats: ExecutionStats): string[] {
  return [...readCounters(stats)].filter(([, c]) => c.executions === 0).map(([table]) => table);
}

export function evidenceGap(stats: ExecutionStats): EvidenceGap | null {
  for (const [table, rows] of Object.entries(stats.tableRows ?? {})) {
    if (rows === 0) return { reason: `${table} has 0 rows`, table };
  }
  const unread = unreadTables(stats);
  const unreached = unreachedTables(stats);
  if (unread.length > 0 || unreached.length > 0) {
    const parts: string[] = [];
    const counters = readCounters(stats);
    if (unread.length > 0) {
      const described = unread.map((table) => {
        const c = counters.get(table)!;
        return `${table}: the ${c.seek ? 'seek' : 'scan'} matched no rows (${c.pages.toLocaleString()} pages read)`;
      });
      parts.push(`${described.join('; ')}: the run did not exercise the data`);
    }
    if (unreached.length > 0) parts.push(`${unreached.join(', ')} not reached: the run stopped before reading it`);
    return { reason: parts.join('; '), table: (unread[0] ?? unreached[0]) ?? null };
  }
  const { logicalReads, elapsed } = metricsOf(stats);
  if (logicalReads === null) return { reason: 'logical reads not captured', table: null };
  if (elapsed === null) return { reason: 'elapsed time not captured', table: null };
  return null;
}

const attrValues = (text: string, attr: string): number[] =>
  [...text.matchAll(new RegExp(`\\b${attr}="(\\d+)"`, 'g'))].map((m) => Number(m[1]));
const sumAttr = (text: string, attr: string): number | null => {
  const values = attrValues(text, attr);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
/** The largest per-thread value. A parallel operator reports one execution per thread, so the sum overcounts. */
const maxAttr = (text: string, attr: string): number | null => {
  const values = attrValues(text, attr);
  return values.length ? Math.max(...values) : null;
};

/**
 * P8-06: operators from the XML showplan, with runtime counters.
 * shortcut: each operator's counters are the text between its RelOp and the next RelOp, which holds for the plans seen so far; upgrade with a real XML parser.
 */
export function planOperators(plan: string | null | undefined): PlanOperator[] {
  if (!plan) return [];
  const out: PlanOperator[] = [];
  for (const chunk of plan.split(/(?=<RelOp\b)/)) {
    const head = /^<RelOp\b[^>]*?\bNodeId="(\d+)"[^>]*?\bPhysicalOp="([^"]+)"/.exec(chunk);
    if (!head) continue;
    const table = /<Object\b[^>]*?\bTable="\[([^\]]+)\]"/.exec(chunk);
    const open = chunk.slice(0, chunk.indexOf('>'));
    const estimate = /\bEstimateRows="([0-9.eE+-]+)"/.exec(open);
    out.push({
      nodeId: Number(head[1]),
      physicalOp: head[2],
      table: table ? table[1] : null,
      actualRows: sumAttr(chunk, 'ActualRows'),
      logicalReads: sumAttr(chunk, 'ActualLogicalReads'),
      // Max, not sum: a parallel operator reports ActualExecutions per thread. An inner loop run by one thread still reports its full count.
      executions: maxAttr(chunk, 'ActualExecutions'),
      estimatedRows: estimate ? Number(estimate[1]) : null,
      spillWrites: /<SpillToTempDb\b/.test(chunk) ? sumAttr(chunk, 'WritesToTempDb') ?? 0 : null,
    });
  }
  return out;
}

const TOP_OPERATORS = 5;
const SCAN_READS_NOTE = 1000;
const LOOP_EXECUTIONS_NOTE = 1000;
/** P8-06: the costliest operators, most logical reads first; operators with no runtime cost are dropped. */
export function topOperators(ops: PlanOperator[]): PlanOperator[] {
  return ops
    .filter((o) => (o.logicalReads ?? 0) > 0 || (o.actualRows ?? 0) > 0 || (o.executions ?? 0) > 1)
    .sort((a, b) => (b.logicalReads ?? 0) - (a.logicalReads ?? 0) || (b.actualRows ?? 0) - (a.actualRows ?? 0))
    .slice(0, TOP_OPERATORS);
}

const COST_SHARE_FINDING = 50;
/** Below this many logical reads a share is noise, not a finding. */
const MIN_READS_FOR_SHARE = 100;
const ESTIMATE_FACTOR_FINDING = 10;
const ESTIMATE_MIN_ROWS = 1000;

/**
 * P8-07: findings from the plan, by operator type and measured counters only.
 * - one operator holds most of the logical reads;
 * - the row estimate is far from the rows actually read, per execution;
 * - an operator spilled to tempdb (its memory grant was too small for the rows).
 */
export function planFindings(ops: PlanOperator[]): PlanFinding[] {
  const findings: PlanFinding[] = [];
  const totalReads = ops.reduce((sum, o) => sum + (o.logicalReads ?? 0), 0);
  for (const o of ops) {
    const name = `${o.physicalOp}${o.table ? ` on ${o.table}` : ''}`;
    const reads = o.logicalReads ?? 0;
    if (totalReads >= MIN_READS_FOR_SHARE && (reads / totalReads) * 100 >= COST_SHARE_FINDING) {
      const pct = Math.round((reads / totalReads) * 100);
      findings.push({
        kind: 'cost-concentration', severity: 'high', operator: o.physicalOp, table: o.table,
        message: `${name} accounts for ${pct}% of logical reads`,
        recommendation: `${name} accounts for ${pct}% of logical reads. Review the predicates and join keys that reach it, and whether an index or a different join would read fewer pages.`,
      });
    }
    if (o.estimatedRows !== null && o.actualRows !== null && o.actualRows >= ESTIMATE_MIN_ROWS) {
      const perExec = o.actualRows / Math.max(o.executions ?? 1, 1);
      const hi = Math.max(o.estimatedRows, perExec);
      const lo = Math.max(Math.min(o.estimatedRows, perExec), 1);
      if (hi / lo >= ESTIMATE_FACTOR_FINDING) {
        findings.push({
          kind: 'row-estimate', severity: 'high', operator: o.physicalOp, table: o.table,
          message: `${name} estimated ${Math.round(o.estimatedRows).toLocaleString()} rows per execution, actual ${Math.round(perExec).toLocaleString()}`,
          recommendation: `${name} was estimated at ${Math.round(o.estimatedRows).toLocaleString()} rows but produced ${Math.round(perExec).toLocaleString()} per execution. Refresh the statistics for the columns it filters or joins on${o.table ? ` in ${o.table}` : ''}, or check for a predicate the optimizer cannot estimate.`,
        });
      }
    }
    if (o.spillWrites !== null) {
      findings.push({
        kind: 'tempdb-spill', severity: 'medium', operator: o.physicalOp, table: o.table,
        message: `${name} spilled ${o.spillWrites.toLocaleString()} pages to tempdb`,
        recommendation: `${name} spilled ${o.spillWrites.toLocaleString()} pages to tempdb: its memory grant was too small for the rows it handled. This usually follows a row estimate far below the actual count; fix the estimate first.`,
      });
    }
  }
  return findings;
}

/** P8-08: standard checks that every execution's analysis includes. */
export const STANDARD_RECOMMENDATIONS: readonly string[] = [
  'Run DBCC SHOW_STATISTICS([Table], [Index]) to validate index selectivity',
  'Consider SET NOCOUNT ON to suppress row count messages and reduce network traffic',
  'Review parameter sniffing: add OPTION (OPTIMIZE FOR UNKNOWN) if plans vary per parameter',
];

/** P8-06: recommendations that name the operator and table that cost the most. */
export function operatorRecommendations(ops: PlanOperator[]): string[] {
  const recs: string[] = [];
  for (const o of ops) {
    if (/Scan$/.test(o.physicalOp) && (o.logicalReads ?? 0) >= SCAN_READS_NOTE) {
      recs.push(`${o.physicalOp} on ${o.table ?? 'an input'}: ${o.logicalReads?.toLocaleString()} logical reads. Look for a predicate that blocks a seek (an OR on a parameter, a function on the column, or an implicit conversion) or a missing index.`);
    }
    // An inner input that runs once per outer row (a row-by-row join), whatever the operator.
    if ((o.executions ?? 0) >= LOOP_EXECUTIONS_NOTE) {
      recs.push(`${o.physicalOp}${o.table ? ` on ${o.table}` : ''} ran ${o.executions?.toLocaleString()} times: a row-by-row join. Rewrite as a set-based join or index the inner input.`);
    }
  }
  return recs;
}

const UNSTABLE_SPREAD_PCT = 25;

function spread(values: number[]): Spread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p95 = sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return { min: sorted[0], median: mid, p95, max: sorted[n - 1] };
}

/** P8-03: summarise measured runs; the first `warmupRuns` are dropped. */
export function summarizeRuns(samples: RunSample[], warmupRuns: number): RunSummary {
  const measured = samples.slice(warmupRuns);
  const elapsed = spread(measured.flatMap((r) => (r.elapsedMs === null ? [] : [r.elapsedMs])));
  const reads = spread(measured.flatMap((r) => (r.logicalReads === null ? [] : [r.logicalReads])));
  const spreadPct = elapsed && elapsed.median > 0 ? ((elapsed.max - elapsed.min) / elapsed.median) * 100 : null;
  return { runs: measured.length, warmupRuns, elapsedMs: elapsed, logicalReads: reads, spreadPct };
}

/** P8-02: READY / OPTIMIZE / INSUFFICIENT EVIDENCE. Evidence checks run before targets. */
export function prodVerdict(stats: ExecutionStats, targets: Targets, runs: RunSummary | null = null): ProdVerdict {
  const gap = evidenceGap(stats);
  if (gap) return { verdict: 'INSUFFICIENT EVIDENCE', reason: gap.reason, driver: gap.table };
  const { logicalReads: reads, elapsed: ms } = metricsOf(stats);
  // evidenceGap has already ruled out missing reads and time.
  if (reads === null || ms === null) throw new Error('evidenceGap must report missing reads or time');
  if (targets.maxLogicalReads === null && targets.maxElapsedMs === null && targets.maxScanCount === null) {
    return { verdict: 'INSUFFICIENT EVIDENCE', reason: 'no targets set', driver: null };
  }
  const scan = ioSum(stats, 'scanCount');
  if (targets.maxLogicalReads !== null && reads > targets.maxLogicalReads) {
    return { verdict: 'OPTIMIZE', reason: `logical reads ${reads} over target ${targets.maxLogicalReads}`, driver: hottest(stats, 'logicalReads') };
  }
  if (targets.maxElapsedMs !== null && ms > targets.maxElapsedMs) {
    return { verdict: 'OPTIMIZE', reason: `elapsed ${ms}ms over target ${targets.maxElapsedMs}ms`, driver: null };
  }
  if (targets.maxScanCount !== null && scan !== null && scan > targets.maxScanCount) {
    return { verdict: 'OPTIMIZE', reason: `scan count ${scan} over target ${targets.maxScanCount}`, driver: hottest(stats, 'scanCount') };
  }
  // P8-03: a READY that rests on unstable timing is not READY.
  if (runs && runs.spreadPct !== null && runs.spreadPct > UNSTABLE_SPREAD_PCT) {
    return { verdict: 'UNSTABLE', reason: `elapsed varies ${Math.round(runs.spreadPct)}% across ${runs.runs} runs`, driver: null };
  }
  return { verdict: 'READY', reason: 'all captured metrics within targets', driver: null };
}

function hottest(stats: ExecutionStats, key: 'logicalReads' | 'scanCount'): string | null {
  const top = [...stats.io].sort((a, b) => b[key] - a[key])[0];
  return top && top[key] > 0 ? top.table : null;
}

/** P8-08: grade limits (a run must be under every limit of a grade). Shown in the grade legend. */
export const GRADE_RULES: Record<Exclude<Grade, 'F'>, { reads: number; ms: number; scans: number | null }> = {
  A: { reads: 200, ms: 50, scans: 1 },
  B: { reads: 1000, ms: 200, scans: 3 },
  C: { reads: 5000, ms: 1000, scans: null },
  D: { reads: 20000, ms: 5000, scans: null },
};

function gradeFromStats(stats: ExecutionStats): Grade | null {
  const { logicalReads: reads, elapsed: ms } = metricsOf(stats);
  const maxScan = stats.io.length ? Math.max(...stats.io.map(r => r.scanCount)) : null;
  // P8-01: a grade needs both measured reads and time; time alone is not enough.
  if (reads === null || ms === null) return null;

  const ok = (v: number | null, limit: number) => v === null || v < limit;
  const scanOk = (limit: number | null) => limit === null || maxScan === null || maxScan <= limit;

  for (const grade of ['A', 'B', 'C', 'D'] as const) {
    const rule = GRADE_RULES[grade];
    if (ok(reads, rule.reads) && ok(ms, rule.ms) && scanOk(rule.scans)) return grade;
  }
  return 'F';
}

// ---------------------------------------------------------------------------
// Single-run analysis
// ---------------------------------------------------------------------------

export function analyzeExecution(result: ExecutionResult, targets: Targets = NO_TARGETS, runs: RunSummary | null = null): AuditAnalysis {
  const stats = result.stats;
  const m = metricsOf(stats);
  const totalLogical = m.logicalReads;
  const totalPhysical = m.physicalReads;
  const totalScan = m.scanCount;
  const elapsed = m.elapsed;

  const gap = evidenceGap(stats);
  // P8-04: no grade while the evidence is incomplete; a grade next to INSUFFICIENT EVIDENCE misleads.
  const grade = gap ? null : gradeFromStats(stats);

  const hotTables = [...stats.io]
    .sort((a, b) => b.logicalReads - a.logicalReads)
    .slice(0, 5)
    .map(row => ({
      table: row.table,
      logicalReads: row.logicalReads,
      scanCount: row.scanCount,
      concern: row.scanCount > 10
        ? 'HIGH: Multiple scans — potential missing index or CURSOR loop'
        : row.logicalReads > 5000
        ? 'HIGH: Large logical read count — consider covering index'
        : row.physicalReads > 100
        ? 'MEDIUM: Physical reads indicate missing data in buffer pool'
        : 'LOW: Acceptable I/O profile',
    }));

  const timeClassification =
    elapsed === null ? 'Not captured'
    : totalLogical === null || totalScan === null ? `Time ${elapsed}ms only — I/O not captured`
    : elapsed < 50 ? 'Excellent (< 50ms)'
    : elapsed < 200 ? 'Good (< 200ms)'
    : elapsed < 1000 ? 'Acceptable (< 1s)'
    : elapsed < 5000 ? 'Slow (1–5s) — needs attention'
    : 'Critical (> 5s) — immediate action required';

  const pros: string[] = [];
  const cons: string[] = [];

  if (totalLogical === null) cons.push('Logical reads not captured');
  else if (grade === 'A' || grade === 'B') pros.push('Logical read count is within acceptable range');
  else cons.push(`High logical reads (${totalLogical.toLocaleString()}) indicate potential table scans`);

  if (elapsed === null) cons.push('Elapsed time not captured');
  else if (elapsed < 200) pros.push('Execution time is acceptable');
  else cons.push(`Execution time (${elapsed}ms) exceeds recommended 200ms threshold`);

  if (totalPhysical === null) cons.push('Physical reads not captured');
  else if (totalPhysical === 0) pros.push('No physical reads — data is in the buffer pool cache');
  else cons.push(`${totalPhysical} physical reads detected — cold cache or missing memory pressure`);

  if (totalScan === null) cons.push('Scan count not captured');
  else if (totalScan <= stats.io.length) pros.push('Scan count is minimal — likely using index seeks');
  else cons.push(`High scan count (${totalScan}) across tables — missing or unused indexes`);

  const operators = planOperators(stats.plan);
  const findings = planFindings(operators);
  const recommendations: string[] = [...new Set([...findings.map((f) => f.recommendation), ...operatorRecommendations(topOperators(operators))])];

  if (totalLogical !== null && totalLogical > 1000) {
    recommendations.push(
      'Run: EXEC sp_helpindex [TableName] to inspect existing indexes on hot tables',
      'Consider adding a covering index: CREATE INDEX IX_Cover ON [Table]([FilterCol]) INCLUDE ([ProjectedCols])',
    );
  }
  if (elapsed !== null && elapsed > 1000) {
    recommendations.push('Enable Query Store and review the top resource-consuming plan');
  }
  if (totalScan !== null && totalScan > stats.io.length * 2) {
    recommendations.push('Review the execution plan for Table Scan / Clustered Index Scan operators and replace with Seeks');
  }
  if (totalPhysical !== null && totalPhysical > 0) {
    recommendations.push('Increase SQL Server max server memory or add frequently accessed tables to memory-optimized structures');
  }
  recommendations.push(...STANDARD_RECOMMENDATIONS);

  const rationales: Record<Grade, string> = {
    A: 'Excellent — minimal I/O, fast execution, optimal index usage',
    B: 'Good — acceptable read counts with minor tuning opportunities',
    C: 'Moderate — noticeable I/O that should be investigated before production scaling',
    D: 'Poor — high I/O or slow execution; refactoring recommended before any scale',
    F: 'Critical — extremely high logical reads or execution time; immediate intervention required',
  };

  return {
    summary: `${result.spLabel} executed in ${fmtMs(elapsed)} with ${fmtN(totalLogical)} total logical reads across ${stats.io.length} table(s). Performance grade: ${grade ?? 'not graded'}.`,
    prodVerdict: prodVerdict(stats, targets, runs),
    multiRun: runs,
    planOperators: topOperators(operators),
    planFindings: findings,
    performanceGrade: grade,
    gradeRationale: grade
      ? rationales[grade]
      : totalLogical === null || elapsed === null
        ? `Not graded — ${[elapsed === null && 'elapsed time', totalLogical === null && 'logical reads'].filter(Boolean).join(' and ')} not captured`
        : `Not graded — ${gap?.reason}`,
    ioAnalysis: { rowCounts: stats.tableRows ?? null, totalLogicalReads: totalLogical, totalPhysicalReads: totalPhysical, totalScanCount: totalScan, hotTables, recommendation: hotTables[0]?.concern || 'No hot tables identified' },
    timeAnalysis: {
      parseTimeMs: stats.parseAndCompileTime ?? null,
      executeTimeMs: stats.executionTime ?? null,
      totalMs: elapsed,
      classification: timeClassification,
      recommendation: elapsed === null
        ? 'Elapsed time not captured — cannot assess'
        : elapsed > 1000
        ? 'Immediate tuning required — consider indexes, rewriting loops, or batching'
        : 'Execution time acceptable — monitor under peak load',
    },
    prosAndCons: { pros, cons },
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Comparison analysis (R003 step 3+4 / R004)
// ---------------------------------------------------------------------------

export function compareExecutions(original: ExecutionResult, optimized: ExecutionResult): {
  original: AuditAnalysis;
  optimized: AuditAnalysis;
  comparison: AuditAnalysis;
  metrics: MetricComparison;
} {
  if (original.stats.simulated !== optimized.stats.simulated) {
    throw new Error(
      'Cannot compare a simulated result with a real execution result: simulated numbers are not measurements (D-004).',
    );
  }

  const origAnalysis = analyzeExecution(original);
  const optAnalysis = analyzeExecution(optimized);

  const o = metricsOf(original.stats);
  const p = metricsOf(optimized.stats);
  const metrics: MetricComparison = {
    logicalReads: delta(o.logicalReads, p.logicalReads),
    physicalReads: delta(o.physicalReads, p.physicalReads),
    scanCount: delta(o.scanCount, p.scanCount),
    cpu: delta(o.cpu, p.cpu),
    elapsed: delta(o.elapsed, p.elapsed),
  };

  // Improvement = reduction, as a positive percent; null when not computable.
  const improvement = (d: MetricDelta): number | null => (d.deltaPct === null ? null : Math.round(-d.deltaPct));
  const logicalImprovement = improvement(metrics.logicalReads);
  const timeImprovement = improvement(metrics.elapsed);

  const describe = (pct: number | null, up: string, down: string): string =>
    pct === null ? 'an unknown change (not captured)' : pct >= 0 ? `${pct}% ${down}` : `${Math.abs(pct)}% ${up}`;

  const comparisonSummary =
    `The optimized SP shows ${describe(logicalImprovement, 'increase', 'reduction')} in logical reads ` +
    `(${fmtN(o.logicalReads)} → ${fmtN(p.logicalReads)}) and ` +
    `${describe(timeImprovement, 'slower execution', 'faster execution')} ` +
    `(${fmtMs(o.elapsed)} → ${fmtMs(p.elapsed)}). Overall grade: ${optAnalysis.performanceGrade ?? 'not graded'}.`;

  const comparison: AuditAnalysis = {
    ...optAnalysis,
    summary: comparisonSummary,
    comparisonSummary,
    improvementPercent: logicalImprovement,
    recommendations: [
      logicalImprovement === null
        ? 'Logical reads not captured for both runs — I/O improvement cannot be assessed'
        : logicalImprovement > 20
        ? `✅ Significant I/O improvement (${logicalImprovement}%) — optimized version recommended for production`
        : `⚠️ I/O improvement marginal (${logicalImprovement}%) — further tuning recommended before production`,
      timeImprovement === null
        ? 'Elapsed time not captured for both runs — time improvement cannot be assessed'
        : timeImprovement > 20
        ? `✅ Execution time improved by ${timeImprovement}%`
        : `⚠️ Execution time change: ${timeImprovement}% — validate under realistic load`,
      ...optAnalysis.recommendations,
    ],
  };

  return { original: origAnalysis, optimized: optAnalysis, comparison, metrics };
}
