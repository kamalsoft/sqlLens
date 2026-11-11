import { describe, expect, it } from 'vitest';
import { PARAM_SET_KEY, readParamSets, setNamesFor, withSet, withoutSet, writeParamSets, type SavedParam } from '@/lib/param-sets';

const row: SavedParam = { name: '@RegionID', type: 'int', value: '1', isNull: false, output: false };

describe('parameter sets (UX-3)', () => {
  it('saves, lists, loads and deletes a named set per procedure', () => {
    let store = withSet({}, 'dbo.Get', 'Q4 2024', [row]);
    store = withSet(store, 'dbo.Get', 'Q1', [row]);
    expect(setNamesFor(store, 'dbo.Get')).toEqual(['Q1', 'Q4 2024']);
    expect(setNamesFor(store, 'dbo.Other')).toEqual([]);
    store = withoutSet(store, 'dbo.Get', 'Q1');
    expect(setNamesFor(store, 'dbo.Get')).toEqual(['Q4 2024']);
  });

  it('round-trips through storage and writes only the sets, never connection fields', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    expect(writeParamSets(storage, withSet({}, 'dbo.Get', 'A', [row]))).toBe(true);
    const stored = data.get(PARAM_SET_KEY) ?? '';
    expect(stored).not.toMatch(/password|username|host/i);
    expect(readParamSets(storage)).toEqual({ 'dbo.Get': { A: [row] } });
  });

  it('ignores broken or malformed stored data instead of throwing', () => {
    expect(readParamSets({ getItem: () => '{not json' })).toEqual({});
    expect(readParamSets({ getItem: () => '[1,2]' })).toEqual({});
    expect(readParamSets({ getItem: () => '{"dbo.Get":{"A":[{"name":1}]}}' })).toEqual({ 'dbo.Get': {} });
    expect(readParamSets(undefined)).toEqual({});
  });

  it('reports a refused write instead of throwing', () => {
    const refused = { setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(writeParamSets(refused, {})).toBe(false);
  });
});
