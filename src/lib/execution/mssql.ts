import sql from 'mssql';
import { parseMssqlStatistics } from '../telemetry/mssql';
import { assertNoDynamicExec, splitGoBatches } from './sql-scan';
import {
  coerceParam, ExecAbortError, ExecTimeoutError, onAbort, TLS_WARNING,
  type DriverOutcome, type ExecConnection, type ExecOptions, type ExecTarget, type ParamType,
} from './types';

interface InfoMessage { message?: string }
interface MssqlRequestLike {
  on(event: 'info', cb: (m: InfoMessage) => void): void;
  input(name: string, type: unknown, value: unknown): void;
  output(name: string, type: unknown, value: unknown): void;
  execute(name: string): Promise<{ recordsets?: unknown[]; output?: Record<string, unknown> }>;
  batch(text: string): Promise<{ recordsets?: unknown[] }>;
  cancel(): void;
}

const SET_STATS = 'SET STATISTICS IO ON; SET STATISTICS TIME ON; SET STATISTICS XML ON;';
const NOISE = /^(Table '|\s*SQL Server (parse and compile time|Execution Times)|\s*CPU time =)/i;

/** Built connection options (P6-08): encrypt on, certificate verified unless explicitly overridden. */
export function buildMssqlConfig(conn: ExecConnection, timeoutMs: number) {
  const encrypt = conn.encrypt ?? true;
  const trustServerCertificate = conn.trustServerCertificate ?? false;
  const warnings: string[] = [];
  if (!encrypt || trustServerCertificate) warnings.push(TLS_WARNING);
  return {
    config: {
      server: conn.host,
      port: conn.port ?? 1433,
      database: conn.database,
      user: conn.username,
      password: conn.password,
      requestTimeout: timeoutMs,
      connectionTimeout: Math.min(timeoutMs, 15_000),
      // One connection: session SET options must apply to the statements that follow.
      pool: { max: 1, min: 0 },
      options: { encrypt, trustServerCertificate },
    },
    warnings,
  };
}

function sqlType(type: ParamType): unknown {
  switch (type) {
    case 'int': return sql.Int;
    case 'bigint': return sql.BigInt;
    case 'decimal': return sql.Decimal(38, 10);
    case 'nvarchar': return sql.NVarChar(sql.MAX);
    case 'varchar': return sql.VarChar(sql.MAX);
    case 'bit': return sql.Bit;
    case 'datetime': return sql.DateTime;
    case 'date': return sql.Date;
    case 'uniqueidentifier': return sql.UniqueIdentifier;
  }
}

/** The showplan arrives as a one-column recordset ("Microsoft SQL Server 2005 XML Showplan"). */
function extractPlans(recordsets: unknown[] | undefined): string | null {
  const plans: string[] = [];
  for (const rs of recordsets ?? []) {
    const first = Array.isArray(rs) ? (rs[0] as Record<string, unknown> | undefined) : undefined;
    if (!first) continue;
    const key = Object.keys(first).find((k) => /showplan/i.test(k));
    if (key === undefined) continue;
    for (const row of rs as Record<string, unknown>[]) {
      const v = row[key];
      if (typeof v === 'string') plans.push(v);
    }
  }
  return plans.length ? plans.join('\n') : null;
}

export async function executeMssql(
  conn: ExecConnection, target: ExecTarget, opts: ExecOptions,
): Promise<DriverOutcome> {
  if (target.kind === 'batch') {
    assertNoDynamicExec(target.sql, 'mssql');
  }
  const { config, warnings } = buildMssqlConfig(conn, opts.timeoutMs);
  const pool = new sql.ConnectionPool(config);
  let current: MssqlRequestLike | null = null;
  let aborted = false;
  let timedOut = false;
  let tx: { begin(): Promise<void>; rollback(): Promise<void>; request(): MssqlRequestLike } | null = null;
  let txAttempted = false;

  const cancel = () => { try { current?.cancel(); } catch { /* already finished */ } };
  const disposeAbort = onAbort(opts.signal, () => { aborted = true; cancel(); });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, opts.timeoutMs);
  const checkFlags = () => {
    if (aborted) throw new ExecAbortError();
    if (timedOut) throw new ExecTimeoutError();
  };

  try {
    if (opts.signal?.aborted) { aborted = true; checkFlags(); }
    await pool.connect();
    checkFlags();

    if (target.kind === 'batch') {
      tx = new sql.Transaction(pool);
      txAttempted = true;
      await tx!.begin();
    }
    const mk = (): MssqlRequestLike => (tx ? tx.request() : pool.request());

    const setup = mk();
    current = setup;
    await setup.batch(SET_STATS);
    checkFlags();

    const infos: string[] = [];
    const recordsets: unknown[] = [];
    let outputs: Record<string, unknown> | undefined;
    const newRequest = (): MssqlRequestLike => {
      const r = mk();
      current = r;
      r.on('info', (m) => { if (m?.message) infos.push(String(m.message)); });
      return r;
    };

    const started = performance.now();
    if (target.kind === 'procedure') {
      const req = newRequest();
      for (const p of target.params) {
        const bind = p.output ? req.output.bind(req) : req.input.bind(req);
        bind(p.name.replace(/^@/, ''), sqlType(p.type), coerceParam(p.type, p.value));
      }
      const called = await req.execute(target.name);
      recordsets.push(...(called.recordsets ?? []));
      outputs = called.output ?? {};
    } else {
      // D-036: GO separators run as separate batches inside the same transaction.
      for (const part of splitGoBatches(target.sql)) {
        recordsets.push(...((await newRequest().batch(part)).recordsets ?? []));
        checkFlags();
      }
    }
    const wallMs = performance.now() - started;
    checkFlags();

    const stats = parseMssqlStatistics(infos.join('\n'));
    stats.plan = extractPlans(recordsets);
    stats.messages = infos.filter((m) => !NOISE.test(m));
    // Wall time is a real measurement, used only when the server reported no timing.
    if (stats.totalElapsedMs === null) stats.totalElapsedMs = Math.round(wallMs);
    // D-039: row counts for the real tables the run read. Read-only, same transaction, no user SQL.
    // The count is advisory: if it fails, the run's results are kept and the gap is reported as a warning.
    const tables = realTables(stats.io);
    if (tables.length > 0) {
      const counter = mk();
      current = counter;
      try {
        stats.tableRows = await countRows(counter, tables);
      } catch (err) {
        if (err instanceof ExecAbortError || err instanceof ExecTimeoutError) throw err;
        warnings.push(`Row counts not captured: ${err instanceof Error ? err.message : 'count failed'}`);
      }
      checkFlags();
    }
    return { stats, warnings, outputs };
  } catch (err) {
    if (err instanceof ExecAbortError || err instanceof ExecTimeoutError) throw err;
    if (aborted) throw new ExecAbortError();
    if (timedOut || (err as { code?: string })?.code === 'ETIMEOUT') throw new ExecTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    disposeAbort();
    // D-036: the batch transaction is rolled back here unless the script committed it.
    if (tx && txAttempted) { try { await tx.rollback(); } catch { /* no active transaction */ } }
    try { await pool.close(); } catch { /* already closed */ }
  }
}

/** Names the run read that could be user tables: temp tables and names that are not plain identifiers are left out. The count query matches only user tables, so system work tables simply return no count. */
const COUNT_TABLE_LIMIT = 50;
function realTables(io: { table: string }[]): string[] {
  const names = [...new Set(io.map((r) => r.table))]
    .filter((t) => !t.startsWith('#') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t));
  return names.slice(0, COUNT_TABLE_LIMIT);
}

/**
 * Row counts from catalog metadata (sys.partitions). Table names are bound as parameters, never
 * spliced into SQL. shortcut: a count from partition metadata, not COUNT_BIG(*); exact for committed rows.
 */
async function countRows(req: MssqlRequestLike, tables: string[]): Promise<Record<string, number>> {
  tables.forEach((t, i) => req.input(`t${i}`, sql.NVarChar(128), t));
  const names = tables.map((_, i) => `@t${i}`).join(', ');
  const r = await req.batch(
    `SELECT o.name AS tableName, SUM(p.[rows]) AS [rowCount] FROM sys.objects AS o ` +
    `INNER JOIN sys.partitions AS p ON p.object_id = o.object_id AND p.index_id IN (0, 1) ` +
    `WHERE o.type = 'U' AND o.name IN (${names}) GROUP BY o.name`,
  );
  const out: Record<string, number> = {};
  for (const row of (r.recordsets?.[0] ?? []) as { tableName: string; rowCount: number | string | null }[]) {
    if (row.rowCount !== null) out[row.tableName] = Number(row.rowCount);
  }
  return out;
}

/** One parameter of a stored procedure, from the catalog (UX-2). */
export interface ProcedureParam { name: string; sqlType: string; isOutput: boolean; hasDefault: boolean }

/**
 * The parameters of a stored procedure, read from the catalog. The procedure name is bound as a
 * parameter, never spliced into the SQL text. Read-only.
 */
export async function listProcedureParams(
  conn: ExecConnection, procName: string, timeoutMs: number,
): Promise<ProcedureParam[]> {
  const { config } = buildMssqlConfig(conn, timeoutMs);
  const pool = new sql.ConnectionPool(config);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = (async () => {
      await pool.connect();
      const req = pool.request();
      req.input('procName', sql.NVarChar(256), procName);
      const r = await req.query(
        `SELECT p.name AS paramName, TYPE_NAME(p.user_type_id) AS typeName, p.is_output AS isOutput, p.has_default_value AS hasDefault ` +
        `FROM sys.parameters AS p WHERE p.object_id = OBJECT_ID(@procName, N'P') ORDER BY p.parameter_id`,
      );
      return ((r.recordset ?? []) as { paramName: string; typeName: string; isOutput: boolean; hasDefault: boolean }[]).map((row) => ({
        name: row.paramName, sqlType: row.typeName, isOutput: !!row.isOutput, hasDefault: !!row.hasDefault,
      }));
    })();
    run.catch(() => {});
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ExecTimeoutError()), timeoutMs); });
    return await Promise.race([run, limit]);
  } finally {
    if (timer) clearTimeout(timer);
    try { await pool.close(); } catch { /* already closed */ }
  }
}

export async function testMssqlConnection(
  conn: ExecConnection, timeoutMs: number,
): Promise<{ serverVersion: string | null; encrypted: boolean; warnings: string[] }> {
  const { config, warnings } = buildMssqlConfig(conn, timeoutMs);
  const pool = new sql.ConnectionPool(config);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = (async () => {
      await pool.connect();
      const r = await pool.request().query('SELECT @@VERSION AS v');
      const v = r?.recordset?.[0]?.v;
      return typeof v === 'string' ? v.split('\n')[0].trim() : null;
    })();
    run.catch(() => {});
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ExecTimeoutError()), timeoutMs); });
    const serverVersion = await Promise.race([run, limit]);
    return { serverVersion, encrypted: config.options.encrypt, warnings };
  } finally {
    if (timer) clearTimeout(timer);
    try { await pool.close(); } catch { /* ignore */ }
  }
}
