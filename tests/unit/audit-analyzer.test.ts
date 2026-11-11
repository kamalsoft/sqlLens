import { describe, expect, it } from 'vitest';
import { analyzeExecution, compareExecutions, operatorRecommendations, planOperators, summarizeRuns, topOperators } from '@/lib/audit-analyzer';
import type { ExecutionResult, ExecutionStats } from '@/lib/sp-executor';

function result(over: Partial<ExecutionStats> = {}, reads: number | null = 100): ExecutionResult {
  const stats: ExecutionStats = {
    parseAndCompileTime: 1, parseAndCompileCpu: 1, executionTime: 10, executionCpu: 8, totalElapsedMs: 11,
    io: reads === null ? [] : [{
      table: 'T', scanCount: 1, logicalReads: reads, physicalReads: 2, readAheadReads: 0,
      lobLogicalReads: 0, lobPhysicalReads: 0, lobReadAheadReads: 0,
    }],
    messages: [], rawOutput: '', plan: null, simulated: false, ...over,
  };
  return { recordNumber: '1', spLabel: 'sp', connectionEngine: 'mssql', executedAt: '', stats, success: true };
}

describe('compareExecutions', () => {
  it('computes per-metric deltas', () => {
    const c = compareExecutions(result({ totalElapsedMs: 100, executionCpu: 50 }, 1000), result({ totalElapsedMs: 50, executionCpu: 25 }, 250));
    expect(c.metrics.logicalReads).toEqual({ original: 1000, optimized: 250, delta: -750, deltaPct: -75 });
    expect(c.metrics.elapsed).toMatchObject({ delta: -50, deltaPct: -50 });
    expect(c.metrics.cpu.delta).toBe(-25);
    expect(c.metrics.scanCount.delta).toBe(0);
    expect(c.metrics.physicalReads.delta).toBe(0);
    expect(c.comparison.improvementPercent).toBe(75);
  });

  it('yields null delta when either side is null', () => {
    const c = compareExecutions(result({ executionCpu: null }), result({ totalElapsedMs: null }, null));
    expect(c.metrics.cpu).toEqual({ original: null, optimized: 8, delta: null, deltaPct: null });
    expect(c.metrics.cpu.delta).toBeNull();
    expect(c.metrics.cpu.deltaPct).toBeNull();
    expect(c.metrics.elapsed.delta).toBeNull();
    expect(c.metrics.logicalReads).toEqual({ original: 100, optimized: null, delta: null, deltaPct: null });
    expect(c.comparison.improvementPercent).toBeNull();
  });

  it('rejects simulated vs real', () => {
    expect(() => compareExecutions(result({ simulated: true }), result())).toThrow(/simulated/i);
    expect(() => compareExecutions(result(), result({ simulated: true }))).toThrow(/D-004/);
  });
});

describe('grading with nulls', () => {
  it('treats null metrics as not captured, not zero', () => {
    const a = analyzeExecution(result({ totalElapsedMs: null }, null));
    expect(a.performanceGrade).toBeNull();
    expect(a.ioAnalysis.totalLogicalReads).toBeNull();
    expect(a.prosAndCons.cons).toContain('Logical reads not captured');
  });

  it('does not grade from one captured metric (P8-01)', () => {
    expect(analyzeExecution(result({ totalElapsedMs: null }, 50)).performanceGrade).toBeNull();
    expect(analyzeExecution(result({ totalElapsedMs: null }, 30000)).performanceGrade).toBeNull();
  });
});

describe('mandatory execution recommendations', () => {
  const MANDATORY = [
    'Run DBCC SHOW_STATISTICS([Table], [Index]) to validate index selectivity',
    'Consider SET NOCOUNT ON to suppress row count messages and reduce network traffic',
    'Review parameter sniffing: add OPTION (OPTIMIZE FOR UNKNOWN) if plans vary per parameter',
  ];
  it.each([
    ['a run with I/O', result()],
    ['a run with no I/O captured', result({}, null)],
    ['a failed run', { ...result({ totalElapsedMs: null, executionTime: null, executionCpu: null }, null), success: false }],
  ])('always includes the three recommendations for %s', (_name, r) => {
    expect(analyzeExecution(r).recommendations).toEqual(expect.arrayContaining(MANDATORY));
  });
});

describe('P8-01 evidence gate', () => {
  it('does not grade a time-only run (no I/O captured)', () => {
    const a = analyzeExecution(result({ totalElapsedMs: 39 }, null));
    expect(a.performanceGrade).toBeNull();
    expect(a.gradeRationale).toBe('Not graded — logical reads not captured');
    expect(a.timeAnalysis.classification).toBe('Time 39ms only — I/O not captured');
  });

  it('does not grade an I/O-only run (no elapsed time)', () => {
    const a = analyzeExecution(result({ totalElapsedMs: null }, 100));
    expect(a.performanceGrade).toBeNull();
    expect(a.gradeRationale).toBe('Not graded — elapsed time not captured');
  });

  it('grades a run with both reads and time, and names both when neither is captured', () => {
    expect(analyzeExecution(result({ totalElapsedMs: 11 }, 100)).performanceGrade).toBe('A');
    const none = analyzeExecution(result({ totalElapsedMs: null }, null));
    expect(none.gradeRationale).toBe('Not graded — elapsed time and logical reads not captured');
  });
});

describe('P8-02 prod-readiness verdict', () => {
  const NO = { maxLogicalReads: null, maxElapsedMs: null, maxScanCount: null };
  const TARGETS = { maxLogicalReads: 100, maxElapsedMs: 1000, maxScanCount: 5 };

  it('returns INSUFFICIENT EVIDENCE when no targets are set', () => {
    expect(analyzeExecution(result({}, 100), NO).prodVerdict.reason).toBe('no targets set');
  });

  it('returns INSUFFICIENT EVIDENCE when reads or time are missing', () => {
    expect(analyzeExecution(result({}, null), TARGETS).prodVerdict.reason).toBe('logical reads not captured');
    expect(analyzeExecution(result({ totalElapsedMs: null }, 100), TARGETS).prodVerdict.reason).toBe('elapsed time not captured');
  });

  it('returns OPTIMIZE with the driving table when reads exceed the target', () => {
    const v = analyzeExecution(result({}, 500), TARGETS).prodVerdict;
    expect(v).toEqual({ verdict: 'OPTIMIZE', reason: 'logical reads 500 over target 100', driver: 'T' });
  });

  it('returns READY when every captured metric is within target', () => {
    expect(analyzeExecution(result({}, 50), TARGETS).prodVerdict.verdict).toBe('READY');
  });
});

describe('D-039 empty table from the row count', () => {
  it('returns INSUFFICIENT EVIDENCE when a real table the run read has 0 rows', () => {
    const r = result({ tableRows: { Customers: 0 } }, 100);
    expect(analyzeExecution(r, { maxLogicalReads: 1000, maxElapsedMs: null, maxScanCount: null }).prodVerdict)
      .toEqual({ verdict: 'INSUFFICIENT EVIDENCE', reason: 'Customers has 0 rows', driver: 'Customers' });
  });
  it('does not block when the counted tables have rows', () => {
    const r = result({ tableRows: { Customers: 1000000 } }, 100);
    expect(analyzeExecution(r, { maxLogicalReads: 1000, maxElapsedMs: null, maxScanCount: null }).prodVerdict.verdict).toBe('READY');
  });
});

describe('P8-04 grade and row counts', () => {
  it('withholds the grade when a read table has 0 rows, and says why', () => {
    const a = analyzeExecution(result({ tableRows: { Customers: 0 } }, 100));
    expect(a.performanceGrade).toBeNull();
    expect(a.gradeRationale).toBe('Not graded — Customers has 0 rows');
  });
  it('keeps the grade when every counted table has rows', () => {
    const a = analyzeExecution(result({ tableRows: { Customers: 5 } }, 100));
    expect(a.performanceGrade).toBe('A');
    expect(a.ioAnalysis.rowCounts).toEqual({ Customers: 5 });
  });
  it('reports null row counts when none were counted', () => {
    expect(analyzeExecution(result({}, 100)).ioAnalysis.rowCounts).toBeNull();
  });
});

describe('P8-06 plan operator summary', () => {
  const plan = [
    '<RelOp NodeId="0" PhysicalOp="Clustered Index Insert" LogicalOp="Insert" EstimateRows="1">',
    '<Update><Object Database="[TestDB]" Schema="[dbo]" Table="[Audit]"></Object></Update>',
    '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="1" ActualLogicalReads="2" ActualExecutions="1"></RunTimeCountersPerThread></RunTimeInformation></RelOp>',
    '<RelOp NodeId="8" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="1">',
    '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="1000000" ActualLogicalReads="9185" ActualExecutions="1"></RunTimeCountersPerThread></RunTimeInformation>',
    '<IndexScan><Object Database="[TestDB]" Schema="[dbo]" Table="[Customers]"></Object></IndexScan></RelOp>',
    '<RelOp NodeId="7" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="1">',
    '<RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="12" ActualLogicalReads="0" ActualExecutions="1000000"></RunTimeCountersPerThread></RunTimeInformation></RelOp>',
  ].join('\n');

  it('parses operators with their runtime counters and table', () => {
    const ops = planOperators(plan);
    expect(ops.map((o) => o.physicalOp)).toEqual(['Clustered Index Insert', 'Clustered Index Scan', 'Nested Loops']);
    expect(ops[1]).toMatchObject({ table: 'Customers', actualRows: 1000000, logicalReads: 9185, executions: 1 });
    expect(ops[0].table).toBe('Audit');
  });

  it('ranks the costliest operators first and drops operators with no cost', () => {
    const top = topOperators(planOperators(plan));
    expect(top[0].physicalOp).toBe('Clustered Index Scan');
    expect(top.some((o) => o.physicalOp === 'Nested Loops')).toBe(true);
  });

  it('names the costly scan and the row-by-row loop in the recommendations, keeping the mandatory three', () => {
    const r = analyzeExecution(result({ plan }, 9195));
    expect(r.recommendations.join('\n')).toMatch(/Clustered Index Scan on Customers: 9,185 logical reads/);
    expect(r.recommendations.join('\n')).toMatch(/Nested Loops ran 1,000,000 times/);
    expect(r.recommendations).toEqual(expect.arrayContaining([
      'Run DBCC SHOW_STATISTICS([Table], [Index]) to validate index selectivity',
      'Consider SET NOCOUNT ON to suppress row count messages and reduce network traffic',
      'Review parameter sniffing: add OPTION (OPTIMIZE FOR UNKNOWN) if plans vary per parameter',
    ]));
    expect(r.planOperators[0].physicalOp).toBe('Clustered Index Scan');
  });
});

describe('P8-03 repeated runs', () => {
  const sample = (elapsedMs: number, logicalReads = 100) => ({ elapsedMs, logicalReads });
  const TARGETS = { maxLogicalReads: 1000, maxElapsedMs: null, maxScanCount: null };

  it('drops the warm-up and reports median, p95 and spread', () => {
    const r = summarizeRuns([sample(900), sample(10), sample(20), sample(30), sample(40)], 1);
    expect(r.runs).toBe(4);
    expect(r.warmupRuns).toBe(1);
    expect(r.elapsedMs).toEqual({ min: 10, median: 25, p95: 40, max: 40 });
    expect(r.spreadPct).toBeCloseTo(120);
  });

  it('gives an UNSTABLE verdict instead of READY when timing varies too much', () => {
    const runs = summarizeRuns([sample(0), sample(10), sample(50)], 1);
    const a = analyzeExecution(result({}, 100), TARGETS, runs);
    expect(a.prodVerdict.verdict).toBe('UNSTABLE');
    expect(a.multiRun).toEqual(runs);
  });

  it('keeps READY when the runs agree', () => {
    const runs = summarizeRuns([sample(0), sample(10), sample(11)], 1);
    expect(analyzeExecution(result({}, 100), TARGETS, runs).prodVerdict.verdict).toBe('READY');
  });

  it('keeps OPTIMIZE over UNSTABLE when a metric is over target', () => {
    const runs = summarizeRuns([sample(0), sample(10), sample(50)], 1);
    expect(analyzeExecution(result({}, 5000), TARGETS, runs).prodVerdict.verdict).toBe('OPTIMIZE');
  });

  it('reports no multi-run summary for a single run', () => {
    expect(analyzeExecution(result({}, 100), TARGETS).multiRun).toBeNull();
  });
});
