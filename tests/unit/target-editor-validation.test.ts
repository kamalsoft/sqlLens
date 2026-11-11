import { describe, expect, it } from 'vitest';
import { buildTarget, emptyDraft, newParamRow, rowError, targetError, type ParamRow, type TargetDraft } from '@/components/execute/target-editor';

const row = (over: Partial<ParamRow>): ParamRow => ({ ...newParamRow(), name: '@p', type: 'int', value: '1', ...over });
const draftWith = (...params: ParamRow[]): TargetDraft => ({ ...emptyDraft(), name: 'dbo.Get', params });

describe('rowError (UX-1 inline validation)', () => {
  it('requires a parameter name shaped like @Name', () => {
    expect(rowError(row({ name: '' }))).toMatch(/Enter the parameter name/);
    expect(rowError(row({ name: '@1bad' }))).toMatch(/Name must look like/);
    expect(rowError(row({ name: '@StartDate' }))).toBeNull();
  });

  it('checks dates, including calendar dates', () => {
    expect(rowError(row({ name: '@d', type: 'date', value: '2024-01-01' }))).toBeNull();
    expect(rowError(row({ name: '@d', type: 'date', value: '2024-1-1' }))).toMatch(/must be a date/);
    expect(rowError(row({ name: '@d', type: 'date', value: '2024-02-30' }))).toMatch(/must be a real date/);
    expect(rowError(row({ name: '@d', type: 'datetime', value: '2024-12-31T23:59' }))).toBeNull();
    expect(rowError(row({ name: '@d', type: 'datetime', value: '2024-12-31 25:00' }))).toMatch(/must be a real date/);
  });

  it('checks the int range and whole numbers', () => {
    expect(rowError(row({ value: '2147483648' }))).toMatch(/outside the int range/);
    expect(rowError(row({ value: '1.5' }))).toMatch(/must be a whole number/);
    expect(rowError(row({ type: 'bigint', value: '2147483648' }))).toBeNull();
  });

  it('accepts NULL for any type without checking the value', () => {
    expect(rowError(row({ type: 'datetime', value: 'garbage', isNull: true }))).toBeNull();
  });
});

describe('targetError and buildTarget', () => {
  it('checks the procedure name', () => {
    expect(targetError('procedure', { ...emptyDraft(), name: 'bad name' })).toMatch(/Procedure name must look like/);
    expect(targetError('procedure', { ...emptyDraft(), name: 'dbo.Get' })).toBeNull();
  });

  it('sends datetime values in SQL form', () => {
    const r = buildTarget('procedure', draftWith(row({ name: '@d', type: 'datetime', value: '2024-12-31T23:59' })));
    expect(r.ok && r.target.kind === 'procedure' && r.target.params[0].value).toBe('2024-12-31 23:59:00');
  });

  it('blocks the run with the first row problem', () => {
    const r = buildTarget('procedure', draftWith(row({ name: '@d', type: 'date', value: '2024-02-30' })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be a real date/);
  });
});

describe('FIX-3 end time stays as typed', () => {
  it('keeps 23:59 as 23:59 in the value sent to the server, in each text form', () => {
    for (const v of ['2026-12-31 23:59', '2026-12-31T23:59', '2026-12-31 23:59:00']) {
      const r = buildTarget('procedure', draftWith(row({ name: '@EndDate', type: 'datetime', value: v })));
      expect(r.ok && r.target.kind === 'procedure' && r.target.params[0].value).toBe('2026-12-31 23:59:00');
    }
  });
});
