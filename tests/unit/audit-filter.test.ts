import { describe, expect, it } from 'vitest';
import { filterAudits, NO_FILTER, type AuditListItem } from '@/lib/audit-filter';

const base = { createdAt: '2026-11-11T07:00:00Z', engine: 'mssql', simulated: false, status: 'ok', hasShare: false };
const items: AuditListItem[] = [
  { ...base, id: '1', type: 'EXECUTE', recordNumber: 7, procedure: 'dbo.usp_GetOrders', grade: 'B', verdict: 'READY' },
  { ...base, id: '2', type: 'EXECUTE_COMPARE', recordNumber: 8, procedure: 'dbo.usp_Old', grade: 'D', verdict: 'OPTIMIZE' },
  { ...base, id: '3', type: 'REVIEW', recordNumber: 9, procedure: null, grade: null, verdict: null },
];

describe('filterAudits (UX-4)', () => {
  it('returns everything with no filter', () => {
    expect(filterAudits(items, NO_FILTER)).toHaveLength(3);
  });

  it('searches the procedure name, the record number and the verdict, ignoring case', () => {
    expect(filterAudits(items, { ...NO_FILTER, query: 'GETORDERS' }).map((a) => a.id)).toEqual(['1']);
    expect(filterAudits(items, { ...NO_FILTER, query: '8' }).map((a) => a.id)).toEqual(['2']);
    expect(filterAudits(items, { ...NO_FILTER, query: 'optimize' }).map((a) => a.id)).toEqual(['2']);
  });

  it('filters by type, verdict and grade, and combines them', () => {
    expect(filterAudits(items, { ...NO_FILTER, type: 'REVIEW' }).map((a) => a.id)).toEqual(['3']);
    expect(filterAudits(items, { ...NO_FILTER, verdict: 'READY' }).map((a) => a.id)).toEqual(['1']);
    expect(filterAudits(items, { ...NO_FILTER, grade: 'D', type: 'EXECUTE' })).toEqual([]);
  });
});
