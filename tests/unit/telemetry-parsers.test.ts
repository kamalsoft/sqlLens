import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMssqlStatistics } from '@/lib/telemetry/mssql';
import { parsePostgresPlan } from '@/lib/telemetry/postgres';

const fx = (n: string) => fs.readFileSync(path.join(__dirname, '../fixtures/telemetry', n), 'utf8');

describe('parseMssqlStatistics', () => {
  it('parses a single statement', () => {
    const s = parseMssqlStatistics(fx('mssql-single.txt'));
    expect(s.io).toEqual([{
      table: 'Orders', scanCount: 1, logicalReads: 420, physicalReads: 3,
      readAheadReads: 0, lobLogicalReads: 0, lobPhysicalReads: 0, lobReadAheadReads: 0,
    }]);
    expect(s.parseAndCompileTime).toBe(2);
    expect(s.parseAndCompileCpu).toBe(2);
    expect(s.executionTime).toBe(40);
    expect(s.executionCpu).toBe(31);
    expect(s.totalElapsedMs).toBe(42);
    expect(s.simulated).toBe(false);
  });

  it('aggregates multiple statements per table and sums execution blocks', () => {
    const s = parseMssqlStatistics(fx('mssql-multi.txt'));
    expect(s.io).toHaveLength(2);
    const orders = s.io.find(r => r.table === 'Orders')!;
    expect(orders).toMatchObject({ scanCount: 4, logicalReads: 150, physicalReads: 3, readAheadReads: 3, lobLogicalReads: 4 });
    expect(s.io.find(r => r.table === 'Customers')!.scanCount).toBe(2);
    expect(s.parseAndCompileTime).toBe(7);
    expect(s.parseAndCompileCpu).toBe(6);
    expect(s.executionTime).toBe(37);
    expect(s.executionCpu).toBe(30);
    expect(s.totalElapsedMs).toBe(44);
  });

  it('parses LOB columns and thousands separators', () => {
    const s = parseMssqlStatistics(fx('mssql-lob-thousands.txt'));
    expect(s.io[0]).toMatchObject({
      logicalReads: 1234, physicalReads: 12, readAheadReads: 1000,
      lobLogicalReads: 2345, lobPhysicalReads: 3, lobReadAheadReads: 4,
    });
    expect(s.executionCpu).toBe(1031);
    expect(s.executionTime).toBe(1240);
    expect(s.parseAndCompileTime).toBeNull();
  });

  it('returns null times when no TIME block is present', () => {
    const s = parseMssqlStatistics(fx('mssql-no-time.txt'));
    expect(s.io[0].logicalReads).toBe(7);
    expect(s.parseAndCompileTime).toBeNull();
    expect(s.executionTime).toBeNull();
    expect(s.executionCpu).toBeNull();
    expect(s.totalElapsedMs).toBeNull();
  });

  it('handles empty input', () => {
    const s = parseMssqlStatistics('');
    expect(s.io).toEqual([]);
    expect(s.totalElapsedMs).toBeNull();
  });
});

describe('parsePostgresPlan', () => {
  it('parses FORMAT TEXT, summing shared hit + read, CPU null', () => {
    const s = parsePostgresPlan(fx('pg-text.txt'));
    expect(s.parseAndCompileTime).toBeCloseTo(0.21);
    expect(s.executionTime).toBeCloseTo(3.402);
    expect(s.totalElapsedMs).toBeCloseTo(3.612);
    expect(s.executionCpu).toBeNull();
    expect(s.parseAndCompileCpu).toBeNull();
    expect(s.io[0]).toMatchObject({ logicalReads: 135, physicalReads: 7 });
    expect(s.simulated).toBe(false);
  });

  it('parses FORMAT JSON', () => {
    const s = parsePostgresPlan(fx('pg-json.json'));
    expect(s.parseAndCompileTime).toBeCloseTo(0.21);
    expect(s.executionTime).toBeCloseTo(3.402);
    expect(s.executionCpu).toBeNull();
    expect(s.io[0]).toMatchObject({ logicalReads: 135, physicalReads: 7 });
    expect(s.plan).toContain('"Plan"');
  });

  it('returns no IO rows for a plan without Buffers', () => {
    const s = parsePostgresPlan(fx('pg-text-nobuffers.txt'));
    expect(s.io).toEqual([]);
    expect(s.executionTime).toBeCloseTo(1.5);
  });

  it('returns nulls for unparseable input', () => {
    const s = parsePostgresPlan('garbage');
    expect(s.executionTime).toBeNull();
    expect(s.totalElapsedMs).toBeNull();
  });
});
