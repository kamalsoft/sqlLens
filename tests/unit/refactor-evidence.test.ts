import { describe, expect, it } from 'vitest';
import type { AuditAnalysis } from '@/lib/audit-analyzer';
import { evidenceInstructions } from '@/lib/refactor-evidence';
import { MAX_INSTRUCTIONS_LENGTH } from '@/lib/refactor-shared';

const analysis = (over: Partial<AuditAnalysis> = {}): AuditAnalysis => ({
  summary: '', multiRun: null, planOperators: [], planFindings: [],
  prodVerdict: { verdict: 'OPTIMIZE', reason: 'Customers scan is 60% of reads', driver: 'Customers' },
  performanceGrade: 'D', gradeRationale: '',
  ioAnalysis: {
    rowCounts: null, totalLogicalReads: 12000, totalPhysicalReads: 0, totalScanCount: 2,
    hotTables: [{ table: 'Customers', logicalReads: 7200, scanCount: 1, concern: 'HIGH' }], recommendation: '',
  },
  timeAnalysis: { parseTimeMs: 1, executeTimeMs: 40, totalMs: 41, classification: '', recommendation: '' },
  prosAndCons: { pros: [], cons: [] }, recommendations: [],
  ...over,
});

describe('evidenceInstructions (RF-4)', () => {
  it('states the verdict, totals, hot tables and plan findings', () => {
    const text = evidenceInstructions(analysis({
      planFindings: [{ kind: 'cost-concentration', severity: 'high', operator: 'Clustered Index Scan', table: 'Customers', message: 'Scan holds 60% of reads.', recommendation: 'Add a seekable index.' }],
    }));
    expect(text).toContain('Verdict: OPTIMIZE. Customers scan is 60% of reads (driver: Customers)');
    expect(text).toContain('Total logical reads: 12000.');
    expect(text).toContain('Elapsed: 41 ms.');
    expect(text).toContain('Table Customers: 7200 logical reads, scan count 1.');
    expect(text).toContain('Plan finding (high): Scan holds 60% of reads. Add a seekable index.');
  });

  it('leaves out metrics that were not captured', () => {
    const base = analysis();
    const text = evidenceInstructions({ ...base, ioAnalysis: { ...base.ioAnalysis, totalLogicalReads: null }, timeAnalysis: { ...base.timeAnalysis, totalMs: null } });
    expect(text).not.toContain('Total logical reads');
    expect(text).not.toContain('Elapsed');
  });

  it('stays within the instructions limit and keeps the closing instruction', () => {
    const long = 'x'.repeat(400);
    const base = analysis();
    const text = evidenceInstructions({
      ...base,
      ioAnalysis: { ...base.ioAnalysis, hotTables: Array.from({ length: 5 }, (_, i) => ({ table: `T${i}${long}`, logicalReads: 1, scanCount: 1, concern: '' })) },
    });
    expect(text.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_LENGTH);
    expect(text.endsWith('Keep the same results and parameters.')).toBe(true);
  });
});
