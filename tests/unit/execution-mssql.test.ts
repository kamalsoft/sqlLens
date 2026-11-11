import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (m: { message: string }) => void;
const h = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    inputs: [] as { name: string; type: unknown; value: unknown }[],
    outputs: [] as { name: string; type: unknown; value: unknown }[],
    procOutput: {} as Record<string, unknown>,
    texts: [] as string[],
    config: null as unknown,
    infos: [] as string[],
    recordsets: [] as unknown[],
    failBatch: null as Error | null,
    hang: false,
    cancelled: 0,
    release: null as null | (() => void),
    trancount: 2,
    countRows: [] as unknown[],
    countFail: false,
  };
  return { state };
});

vi.mock('mssql', () => {
  const s = h.state;
  class Request {
    handlers: Handler[] = [];
    on(_e: string, cb: Handler) { this.handlers.push(cb); }
    input(name: string, type: unknown, value: unknown) { s.inputs.push({ name, type, value }); }
    output(name: string, type: unknown, value: unknown) { s.outputs.push({ name, type, value }); }
    cancel() { s.cancelled++; s.release?.(); }
    async run(text: string) {
      s.texts.push(text);
      if (/^SET STATISTICS/.test(text)) return { recordsets: [] };
      if (/@@TRANCOUNT/.test(text)) return { recordsets: [[{ tc: s.trancount }]] };
      if (s.hang) await new Promise<void>((_, rej) => { s.release = () => rej(Object.assign(new Error('Canceled.'), { code: 'ECANCEL' })); });
      if (s.failBatch) throw s.failBatch;
      if (/sys\.partitions/.test(text)) {
        if (s.countFail) throw new Error('count query failed');
        return { recordsets: [s.countRows] };
      }
      for (const m of s.infos) this.handlers.forEach((cb) => cb({ message: m }));
      return { recordsets: s.recordsets };
    }
    batch(t: string) { return this.run(t); }
    async execute(n: string) { return { ...(await this.run(`EXEC ${n}`)), output: s.procOutput }; }
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
const IO_TEMP = "Table '#StagedSales_000001'. Scan count 1, logical reads 0, physical reads 0, read-ahead reads 0, lob logical reads 0, lob physical reads 0, lob read-ahead reads 0.\nTable 'Worktable'. Scan count 0, logical reads 0, physical reads 0, read-ahead reads 0, lob logical reads 0, lob physical reads 0, lob read-ahead reads 0.";

beforeEach(() => {
  Object.assign(h.state, { calls: [], inputs: [], outputs: [], procOutput: {}, texts: [], infos: [], recordsets: [], failBatch: null, hang: false, cancelled: 0, release: null, trancount: 2, countRows: [], countFail: false });
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

  it('runs COMMIT inside a batch as written (D-036)', async () => {
    await executeMssql(conn, { kind: 'batch', sql: 'UPDATE t SET a=1; COMMIT' }, opts);
    expect(h.state.texts).toContain('UPDATE t SET a=1; COMMIT');
    expect(h.state.calls).toContain('begin');
  });
});

describe('D-034 batch hardening', () => {
  it.each([
    'EXEC dbo.p', 'exec(\'COMMIT\')', 'EXECUTE sp_who', 'SELECT 1;exec sp_x',
    "sp_executesql N'COMMIT'", 'EXEC [sp_executesql] N\'x\'', 'EXEC\n  dbo.p',
  ])('rejects %s in batch mode before connecting', async (sqlText) => {
    await expect(executeMssql(conn, { kind: 'batch', sql: sqlText }, opts)).rejects.toThrow(/use procedure mode to run procedures/);
    expect(h.state.calls).toEqual([]);
  });

  it('allows the word exec inside strings, comments and identifiers', async () => {
    await executeMssql(conn, { kind: 'batch', sql: "SELECT 'exec x', [exec] FROM t -- EXEC y" }, opts);
    expect(h.state.calls).toContain('begin');
  });

  it('runs GO-separated parts as separate batches in the same transaction (D-036)', async () => {
    await executeMssql(conn, { kind: 'batch', sql: 'CREATE PROCEDURE p AS SELECT 1\nGO\nSELECT 2' }, opts);
    const run = h.state.texts.filter((t) => !/SET STATISTICS/.test(t));
    expect(run).toEqual(['CREATE PROCEDURE p AS SELECT 1', 'SELECT 2']);
    expect(h.state.calls).toEqual(['connect', 'begin', 'rollback', 'close']);
  });

  it('wraps the batch in one transaction and does not probe @@TRANCOUNT (D-036)', async () => {
    await executeMssql(conn, { kind: 'batch', sql: 'UPDATE t SET a = 1' }, opts);
    expect(h.state.texts.join('\n')).not.toMatch(/BEGIN TRAN|@@TRANCOUNT/);
    expect(h.state.calls).toEqual(['connect', 'begin', 'rollback', 'close']);
  });

  it('procedure mode is unchanged (no transaction, no probe)', async () => {
    await executeMssql(conn, { kind: 'procedure', name: 'dbo.p', params: [] }, opts);
    expect(h.state.texts.join('\n')).not.toMatch(/BEGIN TRAN|@@TRANCOUNT/);
    expect(h.state.calls).not.toContain('begin');
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

describe('OUTPUT parameters', () => {
  it('binds OUTPUT parameters with output() and returns their values', async () => {
    h.state.procOutput = { ExecutionLogID: 42 };
    const out = await executeMssql(conn, {
      kind: 'procedure', name: 'dbo.p',
      params: [
        { name: '@RegionID', type: 'int', value: 1 },
        { name: '@ExecutionLogID', type: 'int', value: null, output: true },
      ],
    }, opts);
    expect(h.state.inputs.map((i) => i.name)).toEqual(['RegionID']);
    expect(h.state.outputs.map((o) => o.name)).toEqual(['ExecutionLogID']);
    expect(out.outputs).toEqual({ ExecutionLogID: 42 });
  });

  it('returns no outputs for input-only procedures', async () => {
    const out = await executeMssql(conn, { kind: 'procedure', name: 'dbo.p', params: [] }, opts);
    expect(out.outputs).toEqual({});
  });
});

describe('D-039 row counts for tables the run read', () => {
  it('counts the real tables from the IO output and binds names as parameters', async () => {
    h.state.infos = [IO, TIME];
    h.state.countRows = [{ tableName: 'Orders', rowCount: 0 }];
    const out = await executeMssql({ ...conn, trustServerCertificate: true }, { kind: 'batch', sql: 'SELECT 1' }, opts);
    expect(out.stats.tableRows).toEqual({ Orders: 0 });
    // ROWS is a reserved word in T-SQL: the column must be bracketed.
    // ROWS and ROWCOUNT are reserved words in T-SQL: both aliases and columns must be bracketed.
    expect(h.state.texts.find((t) => /sys\.partitions/.test(t))).toMatch(/SUM\(p\.\[rows\]\) AS \[rowCount\]/);
    expect(h.state.inputs).toContainEqual({ name: 't0', type: 'NVarChar(128)', value: 'Orders' });
    expect(h.state.texts.some((t) => /sys\.partitions/.test(t) && !t.includes('Orders'))).toBe(true);
  });

  it('does not count temp tables or the worktable', async () => {
    h.state.infos = [IO_TEMP];
    const out = await executeMssql({ ...conn, trustServerCertificate: true }, { kind: 'batch', sql: 'SELECT 1' }, opts);
    expect(out.stats.tableRows).toBeUndefined();
    expect(h.state.texts.some((t) => /sys\.partitions/.test(t))).toBe(false);
  });
});

describe('row counts are advisory', () => {
  it('keeps the run and reports a warning when the count query fails', async () => {
    h.state.infos = [IO];
    h.state.countFail = true;
    const out = await executeMssql({ ...conn, trustServerCertificate: true }, { kind: 'batch', sql: 'SELECT 1' }, opts);
    expect(out.stats.tableRows).toBeUndefined();
    expect(out.warnings).toContain('Row counts not captured: count query failed');
    expect(out.stats.io[0]).toMatchObject({ table: 'Orders' });
  });
});
