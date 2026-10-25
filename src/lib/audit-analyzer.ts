/**
 * IO/Statistical Audit Analyzer (R004)
 * Deep-dives execution stats, comparing two runs if both are provided.
 */

import type { ExecutionStats, ExecutionResult } from './sp-executor';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AuditAnalysis {
  summary: string;
  /** null when no graded metric was captured. */
  performanceGrade: Grade | null;
  gradeRationale: string;
  ioAnalysis: {
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

function gradeFromStats(stats: ExecutionStats): Grade | null {
  const { logicalReads: reads, elapsed: ms } = metricsOf(stats);
  const maxScan = stats.io.length ? Math.max(...stats.io.map(r => r.scanCount)) : null;
  if (reads === null && ms === null) return null;

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

export function analyzeExecution(result: ExecutionResult): AuditAnalysis {
  const stats = result.stats;
  const m = metricsOf(stats);
  const totalLogical = m.logicalReads;
  const totalPhysical = m.physicalReads;
  const totalScan = m.scanCount;
  const elapsed = m.elapsed;

  const grade = gradeFromStats(stats);

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

  const recommendations: string[] = [];

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
    performanceGrade: grade,
    gradeRationale: grade ? rationales[grade] : 'Not graded — neither logical reads nor elapsed time was captured',
    ioAnalysis: { totalLogicalReads: totalLogical, totalPhysicalReads: totalPhysical, totalScanCount: totalScan, hotTables, recommendation: hotTables[0]?.concern || 'No hot tables identified' },
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
