/**
 * IO/Statistical Audit Analyzer (R004)
 * Deep-dives execution stats, comparing two runs if both are provided.
 */

import type { ExecutionStats, ExecutionResult } from './sp-executor';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ProdVerdictName = 'READY' | 'OPTIMIZE' | 'INSUFFICIENT EVIDENCE';
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
}

export interface AuditAnalysis {
  summary: string;
  /** P8-06: the costliest operators by logical reads, then rows. */
  planOperators: PlanOperator[];
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
export function evidenceGap(stats: ExecutionStats): EvidenceGap | null {
  for (const [table, rows] of Object.entries(stats.tableRows ?? {})) {
    if (rows === 0) return { reason: `${table} has 0 rows`, table };
  }
  const { logicalReads, elapsed } = metricsOf(stats);
  if (logicalReads === null) return { reason: 'logical reads not captured', table: null };
  if (elapsed === null) return { reason: 'elapsed time not captured', table: null };
  return null;
}

const sumAttr = (text: string, attr: string): number | null => {
  const values = [...text.matchAll(new RegExp(`\\b${attr}="(\\d+)"`, 'g'))].map((m) => Number(m[1]));
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
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
    out.push({
      nodeId: Number(head[1]),
      physicalOp: head[2],
      table: table ? table[1] : null,
      actualRows: sumAttr(chunk, 'ActualRows'),
      logicalReads: sumAttr(chunk, 'ActualLogicalReads'),
      executions: sumAttr(chunk, 'ActualExecutions'),
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
    .filter((o) => (o.logicalReads ?? 0) > 0 || (o.actualRows ?? 0) > 0)
    .sort((a, b) => (b.logicalReads ?? 0) - (a.logicalReads ?? 0) || (b.actualRows ?? 0) - (a.actualRows ?? 0))
    .slice(0, TOP_OPERATORS);
}

/** P8-06: recommendations that name the operator and table that cost the most. */
export function operatorRecommendations(ops: PlanOperator[]): string[] {
  const recs: string[] = [];
  for (const o of ops) {
    if (/Scan$/.test(o.physicalOp) && (o.logicalReads ?? 0) >= SCAN_READS_NOTE) {
      recs.push(`${o.physicalOp} on ${o.table ?? 'an input'}: ${o.logicalReads?.toLocaleString()} logical reads. Look for a predicate that blocks a seek (an OR on a parameter, a function on the column, or an implicit conversion) or a missing index.`);
    }
    if (o.physicalOp === 'Nested Loops' && (o.executions ?? 0) >= LOOP_EXECUTIONS_NOTE) {
      recs.push(`Nested Loops ran ${o.executions?.toLocaleString()} times${o.table ? ` on ${o.table}` : ''}: a row-by-row join. Rewrite as a set-based join or index the inner input.`);
    }
  }
  return recs;
}

/** P8-02: READY / OPTIMIZE / INSUFFICIENT EVIDENCE. Evidence checks run before targets. */
export function prodVerdict(stats: ExecutionStats, targets: Targets): ProdVerdict {
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
  return { verdict: 'READY', reason: 'all captured metrics within targets', driver: null };
}

function hottest(stats: ExecutionStats, key: 'logicalReads' | 'scanCount'): string | null {
  const top = [...stats.io].sort((a, b) => b[key] - a[key])[0];
  return top && top[key] > 0 ? top.table : null;
}

function gradeFromStats(stats: ExecutionStats): Grade | null {
  const { logicalReads: reads, elapsed: ms } = metricsOf(stats);
  const maxScan = stats.io.length ? Math.max(...stats.io.map(r => r.scanCount)) : null;
  // P8-01: a grade needs both measured reads and time; time alone is not enough.
  if (reads === null || ms === null) return null;

  const ok = (v: number | null, limit: number) => v === null || v < limit;
  const scanOk = (limit: number) => maxScan === null || maxScan <= limit;

  if (ok(reads, 200) && ok(ms, 50) && scanOk(1)) return 'A';
  if (ok(reads, 1000) && ok(ms, 200) && scanOk(3)) return 'B';
  if (ok(reads, 5000) && ok(ms, 1000)) return 'C';
  if (ok(reads, 20000) && ok(ms, 5000)) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Single-run analysis
// ---------------------------------------------------------------------------

export function analyzeExecution(result: ExecutionResult, targets: Targets = NO_TARGETS): AuditAnalysis {
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
  const recommendations: string[] = operatorRecommendations(topOperators(operators));

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
  recommendations.push(
    'Run DBCC SHOW_STATISTICS([Table], [Index]) to validate index selectivity',
    'Consider SET NOCOUNT ON to suppress row count messages and reduce network traffic',
    'Review parameter sniffing: add OPTION (OPTIMIZE FOR UNKNOWN) if plans vary per parameter',
  );

  const rationales: Record<Grade, string> = {
    A: 'Excellent — minimal I/O, fast execution, optimal index usage',
    B: 'Good — acceptable read counts with minor tuning opportunities',
    C: 'Moderate — noticeable I/O that should be investigated before production scaling',
    D: 'Poor — high I/O or slow execution; refactoring recommended before any scale',
    F: 'Critical — extremely high logical reads or execution time; immediate intervention required',
  };

  return {
    summary: `${result.spLabel} executed in ${fmtMs(elapsed)} with ${fmtN(totalLogical)} total logical reads across ${stats.io.length} table(s). Performance grade: ${grade ?? 'not graded'}.`,
    prodVerdict: prodVerdict(stats, targets),
    planOperators: topOperators(operators),
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
