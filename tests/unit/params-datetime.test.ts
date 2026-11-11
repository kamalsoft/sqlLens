import { describe, expect, it } from 'vitest';
import { coerceParam } from '@/lib/execution/types';

// DT-1: a naive date-time is its literal components in UTC. These hold in any local time zone.
describe('datetime parameters (DT-1)', () => {
  it('keeps the literal components of a date-time with a time', () => {
    const v = coerceParam('datetime', '2024-01-01 00:00:00') as Date;
    expect(v.getTime()).toBe(Date.UTC(2024, 0, 1, 0, 0, 0));
  });

  it('accepts the T separator from a datetime-local input, and minutes without seconds', () => {
    const v = coerceParam('datetime', '2024-12-31T23:59') as Date;
    expect(v.getTime()).toBe(Date.UTC(2024, 11, 31, 23, 59, 0));
  });

  it('keeps a date-only value at midnight UTC', () => {
    const v = coerceParam('date', '2026-01-01') as Date;
    expect(v.getTime()).toBe(Date.UTC(2026, 0, 1));
  });

  it('rejects calendar dates and times that do not exist', () => {
    expect(() => coerceParam('datetime', '2024-02-30 00:00:00')).toThrow(RangeError);
    expect(() => coerceParam('datetime', '2024-01-01 25:00:00')).toThrow(RangeError);
  });

  it('still reads a value that carries its own time zone', () => {
    const v = coerceParam('datetime', '2024-01-01T00:00:00Z') as Date;
    expect(v.getTime()).toBe(Date.UTC(2024, 0, 1));
  });

  it('rejects an offset string whose calendar date does not exist, instead of rolling over', () => {
    expect(() => coerceParam('datetime', '2024-02-30T00:00:00Z')).toThrow(RangeError);
    expect(() => coerceParam('datetime', '2024-02-30T00:00:00+02:00')).toThrow(RangeError);
  });

  it('rejects text forms that carry no offset, so the local time zone never decides', () => {
    expect(() => coerceParam('datetime', 'Feb 30 2024')).toThrow(RangeError);
    expect(() => coerceParam('datetime', '2024/01/01 00:00')).toThrow(RangeError);
  });

  it('rejects 24:00 rather than moving it to the next day', () => {
    expect(() => coerceParam('datetime', '2024-01-01 24:00')).toThrow(RangeError);
  });

  it('keeps fractional seconds as milliseconds, with and without the T separator', () => {
    expect((coerceParam('datetime', '2024-01-01 00:00:00.123') as Date).getTime()).toBe(Date.UTC(2024, 0, 1, 0, 0, 0, 123));
    expect((coerceParam('datetime', '2024-01-01T00:00:00.5') as Date).getTime()).toBe(Date.UTC(2024, 0, 1, 0, 0, 0, 500));
  });

  it('applies an explicit offset to the instant it names', () => {
    expect((coerceParam('datetime', '2024-01-01T00:00:00+02:00') as Date).getTime()).toBe(Date.UTC(2023, 11, 31, 22, 0, 0));
  });

  it('gives Postgres the same UTC instant for a naive value (timestamptz)', () => {
    expect((coerceParam('datetime', '2024-01-01 00:00:00') as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('keeps fractional seconds with an offset, and rejects an offset that no zone uses', () => {
    expect((coerceParam('datetime', '2024-01-01T00:00:00.123+02:00') as Date).getTime()).toBe(Date.UTC(2023, 11, 31, 22, 0, 0, 123));
    expect(() => coerceParam('datetime', '2024-01-01T00:00:00+99:99')).toThrow(RangeError);
  });
});
