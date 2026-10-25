import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: {
    log: [] as { text: string; values?: unknown[] }[],
    configs: [] as Record<string, unknown>[],
    ended: 0,
    failOn: null as null | { match: RegExp; error: Error },
    hangOn: null as null | RegExp,
    release: null as null | (() => void),
    cancelCalls: 0,
  },
}));

vi.mock('pg', () => {
  const s = h.state;
  class Client {
    processID = 4242;
    constructor(cfg: Record<string, unknown>) { s.configs.push(cfg); }
    async connect() {}
    async end() { s.ended++; }
    async query(text: string, values?: unknown[]) {
      s.log.push({ text, values });
      if (/pg_cancel_backend/.test(text)) { s.cancelCalls++; s.release?.(); return { rows: [] }; }
      if (s.hangOn?.test(text)) {
        await new Promise<void>((_, rej) => { s.release = () => rej(Object.assign(new Error('canceling statement'), { code: '57014' })); });
      }
      if (s.failOn?.match.test(text)) throw s.failOn.error;
      if (/^EXPLAIN/.test(text)) {
        return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Shared Hit Blocks': 5, 'Shared Read Blocks': 1 }, 'Planning Time': 0.5, 'Execution Time': 2.5 }] }] };
      }
      if (/SHOW server_version/.test(text)) return { rows: [{ server_version: '16.2' }] };
      return { rows: [] };
    }
  }
  return { default: { Client } };
});

import { buildPgConfig, executePostgres, testPostgresConnection } from '@/lib/execution/postgres';
import { ExecAbortError, ExecTimeoutError, TLS_WARNING } from '@/lib/execution/types';

const conn = { host: 'db.example.com', database: 'app', username: 'u', password: 'Sup3rSecret!' };
const opts = { timeoutMs: 4000 };
const texts = () => h.state.log.map((l) => l.text);

beforeEach(() => {
  Object.assign(h.state, { log: [], configs: [], ended: 0, failOn: null, hangOn: null, release: null, cancelCalls: 0 });
});

describe('pg TLS (P6-08)', () => {
  it('verifies certificates for remote hosts', () => {
    const { config, warnings } = buildPgConfig(conn, 1000);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(warnings).toEqual([]);
  });
  it.each(['localhost', '127.0.0.1', '::1'])('does not force TLS on %s', (host) => {
    const { config } = buildPgConfig({ ...conn, host }, 1000);
    expect('ssl' in config).toBe(false);
  });
  it('warns when verification is explicitly disabled', () => {
    const r = buildPgConfig({ ...conn, trustServerCertificate: true }, 1000);
    expect(r.config.ssl).toEqual({ rejectUnauthorized: false });
    expect(r.warnings).toEqual([TLS_WARNING]);
    expect(buildPgConfig({ ...conn, encrypt: false }, 1000).warnings).toEqual([TLS_WARNING]);
  });
});

describe('executePostgres', () => {
  it('procedure: CALL with bound, cast placeholders; timing only', async () => {
    const out = await executePostgres(conn, {
      kind: 'procedure', name: 'public.do_work',
      params: [{ name: 'n', type: 'int', value: 5 }, { name: 's', type: 'varchar', value: "a'; DROP TABLE x;--" }],
    }, opts);
    const call = h.state.log.find((l) => /^CALL/.test(l.text))!;
    expect(call.text).toBe('CALL public.do_work($1::integer, $2::text)');
    expect(call.values).toEqual([5, "a'; DROP TABLE x;--"]);
    expect(texts().join('\n')).not.toContain('DROP TABLE');
    expect(out.stats.totalElapsedMs).not.toBeNull();
    expect(out.stats.executionTime).toBeNull();
    expect(out.stats.io).toEqual([]);
    expect(texts()).not.toContain('BEGIN');
    expect(h.state.ended).toBe(1);
  });

  it('sets statement_timeout from config via a bound value', async () => {
    await executePostgres(conn, { kind: 'procedure', name: 'p', params: [] }, opts);
    expect(h.state.log[0]).toMatchObject({ values: ['4000'] });
    expect(h.state.log[0].text).toContain('statement_timeout');
  });

  it('batch: EXPLAIN inside BEGIN, other statements timed, always ROLLBACK', async () => {
    const out = await executePostgres(conn, {
      kind: 'batch', sql: "UPDATE t SET a = ';'; CREATE TABLE z(i int); SELECT 1",
    }, opts);
    const t = texts();
    const b = t.indexOf('BEGIN');
    expect(b).toBeGreaterThan(-1);
    expect(t[b + 1]).toBe("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) UPDATE t SET a = ';'");
    expect(t[b + 2]).toBe('CREATE TABLE z(i int)');
    expect(t[b + 3]).toMatch(/^EXPLAIN .* SELECT 1$/);
    expect(t.at(-1)).toBe('ROLLBACK');
    expect(t).not.toContain('COMMIT');
    expect(out.stats.executionTime).toBe(5);
    expect(out.stats.plan).toContain('Planning Time');
    expect(h.state.ended).toBe(1);
  });

  it('rolls back after an error', async () => {
    h.state.failOn = { match: /^EXPLAIN/, error: new Error('relation missing') };
    await expect(executePostgres(conn, { kind: 'batch', sql: 'SELECT * FROM nope' }, opts)).rejects.toThrow('relation missing');
    expect(texts().at(-1)).toBe('ROLLBACK');
    expect(h.state.ended).toBe(1);
  });

  it('cancels the backend through a second client on abort, then rolls back', async () => {
    h.state.hangOn = /^EXPLAIN/;
    const ac = new AbortController();
    const p = executePostgres(conn, { kind: 'batch', sql: 'SELECT pg_sleep(60)' }, { ...opts, signal: ac.signal });
    await vi.waitFor(() => expect(texts().some((x) => /^EXPLAIN/.test(x))).toBe(true));
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(ExecAbortError);
    expect(h.state.cancelCalls).toBe(1);
    expect(h.state.log.find((l) => /pg_cancel_backend/.test(l.text))?.values).toEqual([4242]);
    expect(texts().at(-1)).toBe('ROLLBACK');
    expect(h.state.ended).toBe(h.state.configs.length);
  });

  it('maps SQLSTATE 57014 to a timeout', async () => {
    h.state.failOn = { match: /^EXPLAIN/, error: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) };
    await expect(executePostgres(conn, { kind: 'batch', sql: 'SELECT 1' }, opts)).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(texts().at(-1)).toBe('ROLLBACK');
  });

  it.each(['COMMIT', 'select 1; commit', "SELECT 1; E'\\''; END"])('rejects transaction control: %s', async (sql) => {
    await expect(executePostgres(conn, { kind: 'batch', sql }, opts)).rejects.toThrow(/Transaction control/);
    expect(h.state.configs).toHaveLength(0);
  });
});

describe('testPostgresConnection', () => {
  it('returns version and encryption flag', async () => {
    const r = await testPostgresConnection(conn, 5000);
    expect(r).toMatchObject({ serverVersion: '16.2', encrypted: true });
  });
});
