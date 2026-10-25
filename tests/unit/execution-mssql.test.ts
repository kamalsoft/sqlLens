import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (m: { message: string }) => void;
const h = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    inputs: [] as { name: string; type: unknown; value: unknown }[],
    texts: [] as string[],
    config: null as unknown,
    infos: [] as string[],
    recordsets: [] as unknown[],
    failBatch: null as Error | null,
    hang: false,
    cancelled: 0,
    release: null as null | (() => void),
  };
  return { state };
});

vi.mock('mssql', () => {
  const s = h.state;
  class Request {
    handlers: Handler[] = [];
    on(_e: string, cb: Handler) { this.handlers.push(cb); }
    input(name: string, type: unknown, value: unknown) { s.inputs.push({ name, type, value }); }
    cancel() { s.cancelled++; s.release?.(); }
    async run(text: string) {
      s.texts.push(text);
      if (/^SET STATISTICS/.test(text)) return { recordsets: [] };
      if (s.hang) await new Promise<void>((_, rej) => { s.release = () => rej(Object.assign(new Error('Canceled.'), { code: 'ECANCEL' })); });
      if (s.failBatch) throw s.failBatch;
      for (const m of s.infos) this.handlers.forEach((cb) => cb({ message: m }));
      return { recordsets: s.recordsets };
    }
    batch(t: string) { return this.run(t); }
    execute(n: string) { return this.run(`EXEC ${n}`); }
  }
  class ConnectionPool {
    constructor(cfg: unknown) { s.config = cfg; }
    async connect() { s.calls.push('connect'); }
    request() { return new Request(); }
    async close() { s.calls.push('close'); }
  }
  class Transaction {
    constructor(p: unknown) { void p; }
    async begin() { s.calls.push('begin'); }
    async rollback() { s.calls.push('rollback'); }
    async commit() { s.calls.push('commit'); }
    request() { return new Request(); }
  }
  const t = (n: string) => n;
  return {
    default: {
      ConnectionPool, Transaction, MAX: 'MAX',
      Int: t('Int'), BigInt: t('BigInt'), Bit: t('Bit'), DateTime: t('DateTime'), Date: t('Date'),
      UniqueIdentifier: t('UniqueIdentifier'),
      Decimal: (p: number, sc: number) => `Decimal(${p},${sc})`,
      NVarChar: (n: string) => `NVarChar(${n})`, VarChar: (n: string) => `VarChar(${n})`,
    },
  };
});

import { buildMssqlConfig, executeMssql, testMssqlConnection } from '@/lib/execution/mssql';
import { ExecAbortError, ExecTimeoutError, TLS_WARNING } from '@/lib/execution/types';

const conn = { host: 'db.example.com', database: 'app', username: 'sa', password: 'Sup3rSecret!' };
const opts = { timeoutMs: 5000 };
const IO = "Table 'Orders'. Scan count 1, logical reads 42, physical reads 2, read-ahead reads 0, lob logical reads 0, lob physical reads 0, lob read-ahead reads 0.";
const TIME = ' SQL Server Execution Times:\n   CPU time = 5 ms,  elapsed time = 9 ms.';

beforeEach(() => {
  Object.assign(h.state, { calls: [], inputs: [], texts: [], infos: [], recordsets: [], failBatch: null, hang: false, cancelled: 0, release: null });
});

describe('mssql TLS defaults (P6-08)', () => {
  it('encrypts and verifies by default', () => {
    const { config, warnings } = buildMssqlConfig(conn, 1000);
    expect(config.options).toEqual({ encrypt: true, trustServerCertificate: false });
    expect(config.requestTimeout).toBe(1000);
    expect(warnings).toEqual([]);
  });
  it('warns on explicit override', () => {
    expect(buildMssqlConfig({ ...conn, trustServerCertificate: true }, 1).warnings).toEqual([TLS_WARNING]);
    expect(buildMssqlConfig({ ...conn, encrypt: false }, 1).warnings).toEqual([TLS_WARNING]);
  });
});

describe('executeMssql', () => {
  it('captures info events and the showplan, and surfaces the warning', async () => {
    h.state.infos = [IO, TIME];
    h.state.recordsets = [[{ a: 1 }], [{ 'Microsoft SQL Server 2005 XML Showplan': '<ShowPlanXML/>' }]];
    const out = await executeMssql({ ...conn, trustServerCertificate: true }, { kind: 'batch', sql: 'SELECT 1' }, opts);
    expect(out.stats.io[0]).toMatchObject({ table: 'Orders', logicalReads: 42 });
    expect(out.stats.executionTime).toBe(9);
    expect(out.stats.plan).toBe('<ShowPlanXML/>');
    expect(out.stats.simulated).toBe(false);
    expect(out.warnings).toEqual([TLS_WARNING]);
    expect(h.state.texts[0]).toContain('STATISTICS XML ON');
  });

  it('procedure mode binds typed parameters and never interpolates values', async () => {
    await executeMssql(conn, {
      kind: 'procedure', name: 'dbo.GetOrders',
      params: [
        { name: '@CustomerId', type: 'int', value: '7' },
        { name: 'Note', type: 'nvarchar', value: "x'; DROP TABLE t;--" },
      ],
    }, opts);
    expect(h.state.inputs).toEqual([
      { name: 'CustomerId', type: 'Int', value: 7 },
      { name: 'Note', type: 'NVarChar(MAX)', value: "x'; DROP TABLE t;--" },
    ]);
    expect(h.state.texts.join('\n')).not.toContain('DROP TABLE');
    expect(h.state.texts).toContain('EXEC dbo.GetOrders');
    expect(h.state.calls).not.toContain('begin');
    expect(h.state.calls.at(-1)).toBe('close');
  });

  it('rolls back and closes after success', async () => {
    await executeMssql(conn, { kind: 'batch', sql: 'UPDATE t SET a = 1' }, opts);
    expect(h.state.calls).toEqual(['connect', 'begin', 'rollback', 'close']);
  });

  it('rolls back and closes after an error', async () => {
    h.state.failBatch = new Error('boom');
    await expect(executeMssql(conn, { kind: 'batch', sql: 'x' }, opts)).rejects.toThrow('boom');
    expect(h.state.calls).toEqual(['connect', 'begin', 'rollback', 'close']);
    expect(h.state.calls).not.toContain('commit');
  });

  it('cancels the request and still rolls back on abort', async () => {
    h.state.hang = true;
    const ac = new AbortController();
    const p = executeMssql(conn, { kind: 'batch', sql: 'WAITFOR DELAY' }, { ...opts, signal: ac.signal });
    await vi.waitFor(() => expect(h.state.texts.length).toBe(2));
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(ExecAbortError);
    expect(h.state.cancelled).toBe(1);
    expect(h.state.calls).toEqual(['connect', 'begin', 'rollback', 'close']);
  });

  it('maps a driver timeout to ExecTimeoutError and still rolls back', async () => {
    h.state.failBatch = Object.assign(new Error('Timeout: Request failed to complete'), { code: 'ETIMEOUT' });
    await expect(executeMssql(conn, { kind: 'batch', sql: 'x' }, opts)).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(h.state.calls).toContain('rollback');
  });

  it('rejects COMMIT inside a batch before connecting', async () => {
    await expect(executeMssql(conn, { kind: 'batch', sql: 'UPDATE t SET a=1; COMMIT' }, opts)).rejects.toThrow(/Transaction control/);
    expect(h.state.calls).toEqual([]);
  });
});

describe('testMssqlConnection', () => {
  it('times out when the server never answers', async () => {
    vi.useFakeTimers();
    try {
      const mod = await import('mssql');
      const orig = mod.default.ConnectionPool.prototype.connect;
      mod.default.ConnectionPool.prototype.connect = () => new Promise(() => {});
      const p = testMssqlConnection(conn, 5000);
      const assertion = expect(p).rejects.toBeInstanceOf(ExecTimeoutError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      mod.default.ConnectionPool.prototype.connect = orig;
    } finally {
      vi.useRealTimers();
    }
  });
});
