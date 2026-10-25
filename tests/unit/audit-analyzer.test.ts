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
  return { recordNumber: '1', spLabel: 'sp', connectionEngine: 'mssql', executedAt: '', stats, textFilePath: '', success: true };
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

  it('grades on the captured metric only', () => {
    expect(analyzeExecution(result({ totalElapsedMs: null }, 50)).performanceGrade).toBe('A');
    expect(analyzeExecution(result({ totalElapsedMs: null }, 30000)).performanceGrade).toBe('F');
  });
});
