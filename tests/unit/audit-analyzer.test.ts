import { describe, expect, it } from 'vitest';
import { analyzeExecution, compareExecutions } from '@/lib/audit-analyzer';
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
