/**
 * IO/Statistical Audit Analyzer (R004)
 * Deep-dives execution stats, comparing two runs if both are provided.
 */

import { ExecutionStats, ExecutionResult } from './sp-executor';

export interface AuditAnalysis {
  summary: string;
  performanceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  gradeRationale: string;
  ioAnalysis: {
    totalLogicalReads: number;
    totalPhysicalReads: number;
    totalScanCount: number;
    hotTables: { table: string; logicalReads: number; scanCount: number; concern: string }[];
    recommendation: string;
  };
  timeAnalysis: {
    parseTimeMs: number;
    executeTimeMs: number;
    totalMs: number;
    classification: string;
    recommendation: string;
  };
  prosAndCons: { pros: string[]; cons: string[] };
  recommendations: string[];
  comparisonSummary?: string;
  improvementPercent?: number;
}

// ---------------------------------------------------------------------------
// Grade thresholds (logical reads)
// ---------------------------------------------------------------------------

function gradeFromStats(stats: ExecutionStats): 'A' | 'B' | 'C' | 'D' | 'F' {
  const totalLogical = stats.io.reduce((s, r) => s + r.logicalReads, 0);
  const maxScan = Math.max(...stats.io.map(r => r.scanCount), 0);
  const execMs = stats.totalElapsedMs;

  if (totalLogical < 200 && execMs < 50 && maxScan <= 1) return 'A';
  if (totalLogical < 1000 && execMs < 200 && maxScan <= 3) return 'B';
  if (totalLogical < 5000 && execMs < 1000) return 'C';
  if (totalLogical < 20000 && execMs < 5000) return 'D';
  return 'F';
}

function gradeColor(grade: string) {
  return { A: 'green', B: 'blue', C: 'yellow', D: 'orange', F: 'red' }[grade] ?? 'gray';
}

// ---------------------------------------------------------------------------
// Single-run analysis
// ---------------------------------------------------------------------------

export function analyzeExecution(result: ExecutionResult): AuditAnalysis {
  const stats = result.stats;
  const totalLogical = stats.io.reduce((s, r) => s + r.logicalReads, 0);
  const totalPhysical = stats.io.reduce((s, r) => s + r.physicalReads, 0);
  const totalScan = stats.io.reduce((s, r) => s + r.scanCount, 0);

  const grade = gradeFromStats(stats);

  const hotTables = stats.io
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
    stats.totalElapsedMs < 50 ? 'Excellent (< 50ms)'
    : stats.totalElapsedMs < 200 ? 'Good (< 200ms)'
    : stats.totalElapsedMs < 1000 ? 'Acceptable (< 1s)'
    : stats.totalElapsedMs < 5000 ? 'Slow (1–5s) — needs attention'
    : 'Critical (> 5s) — immediate action required';

  const pros: string[] = [];
  const cons: string[] = [];

  if (grade === 'A' || grade === 'B') pros.push('Logical read count is within acceptable range');
  else cons.push(`High logical reads (${totalLogical.toLocaleString()}) indicate potential table scans`);

  if (stats.totalElapsedMs < 200) pros.push('Execution time is acceptable');
  else cons.push(`Execution time (${stats.totalElapsedMs}ms) exceeds recommended 200ms threshold`);

  if (totalPhysical === 0) pros.push('No physical reads — data is in the buffer pool cache');
  else cons.push(`${totalPhysical} physical reads detected — cold cache or missing memory pressure`);

  if (totalScan <= stats.io.length) pros.push('Scan count is minimal — likely using index seeks');
  else cons.push(`High scan count (${totalScan}) across tables — missing or unused indexes`);

  const recommendations: string[] = [];

  if (totalLogical > 1000) {
    recommendations.push(
      'Run: EXEC sp_helpindex [TableName] to inspect existing indexes on hot tables',
      'Consider adding a covering index: CREATE INDEX IX_Cover ON [Table]([FilterCol]) INCLUDE ([ProjectedCols])',
    );
  }
  if (stats.totalElapsedMs > 1000) {
    recommendations.push('Enable Query Store and review the top resource-consuming plan');
  }
  if (totalScan > stats.io.length * 2) {
    recommendations.push('Review the execution plan for Table Scan / Clustered Index Scan operators and replace with Seeks');
  }
  if (totalPhysical > 0) {
    recommendations.push('Increase SQL Server max server memory or add frequently accessed tables to memory-optimized structures');
  }
  recommendations.push(
    'Run DBCC SHOW_STATISTICS([Table], [Index]) to validate index selectivity',
    'Consider SET NOCOUNT ON to suppress row count messages and reduce network traffic',
    'Review parameter sniffing: add OPTION (OPTIMIZE FOR UNKNOWN) if plans vary per parameter',
  );

  return {
    summary: `${result.spLabel} executed in ${stats.totalElapsedMs}ms with ${totalLogical.toLocaleString()} total logical reads across ${stats.io.length} table(s). Performance grade: ${grade}.`,
    performanceGrade: grade,
    gradeRationale: {
      A: 'Excellent — minimal I/O, fast execution, optimal index usage',
      B: 'Good — acceptable read counts with minor tuning opportunities',
      C: 'Moderate — noticeable I/O that should be investigated before production scaling',
      D: 'Poor — high I/O or slow execution; refactoring recommended before any scale',
      F: 'Critical — extremely high logical reads or execution time; immediate intervention required',
    }[grade],
    ioAnalysis: { totalLogicalReads: totalLogical, totalPhysicalReads: totalPhysical, totalScanCount: totalScan, hotTables, recommendation: hotTables[0]?.concern || 'No hot tables identified' },
    timeAnalysis: {
      parseTimeMs: stats.parseAndCompileTime,
      executeTimeMs: stats.executionTime,
      totalMs: stats.totalElapsedMs,
      classification: timeClassification,
      recommendation: stats.totalElapsedMs > 1000
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
} {
  const origAnalysis = analyzeExecution(original);
  const optAnalysis = analyzeExecution(optimized);

  const origLogical = original.stats.io.reduce((s, r) => s + r.logicalReads, 0);
  const optLogical = optimized.stats.io.reduce((s, r) => s + r.logicalReads, 0);
  const logicalImprovement = origLogical > 0 ? Math.round(((origLogical - optLogical) / origLogical) * 100) : 0;

  const origTime = original.stats.totalElapsedMs;
  const optTime = optimized.stats.totalElapsedMs;
  const timeImprovement = origTime > 0 ? Math.round(((origTime - optTime) / origTime) * 100) : 0;

  const overallGrade = optAnalysis.performanceGrade;

  const comparisonSummary = `The optimized SP shows ${logicalImprovement > 0 ? `a ${logicalImprovement}% reduction` : `a ${Math.abs(logicalImprovement)}% increase`} in logical reads ` +
    `(${origLogical.toLocaleString()} → ${optLogical.toLocaleString()}) and ` +
    `${timeImprovement > 0 ? `${timeImprovement}% faster execution` : `${Math.abs(timeImprovement)}% slower execution`} ` +
    `(${origTime}ms → ${optTime}ms). Overall grade: ${overallGrade}.`;

  const comparison: AuditAnalysis = {
    ...optAnalysis,
    summary: comparisonSummary,
    comparisonSummary,
    improvementPercent: logicalImprovement,
    recommendations: [
      logicalImprovement > 20
        ? `✅ Significant I/O improvement (${logicalImprovement}%) — optimized version recommended for production`
        : `⚠️ I/O improvement marginal (${logicalImprovement}%) — further tuning recommended before production`,
      timeImprovement > 20
        ? `✅ Execution time improved by ${timeImprovement}%`
        : `⚠️ Execution time change: ${timeImprovement}% — validate under realistic load`,
      ...optAnalysis.recommendations,
    ],
  };

  return { original: origAnalysis, optimized: optAnalysis, comparison };
}
