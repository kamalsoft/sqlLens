import sql from 'mssql';
import { parseMssqlStatistics } from '../telemetry/mssql';
import { assertNoTransactionControl } from './sql-scan';
import {
  coerceParam, ExecAbortError, ExecTimeoutError, onAbort, TLS_WARNING,
  type DriverOutcome, type ExecConnection, type ExecOptions, type ExecTarget, type ParamType,
} from './types';

interface InfoMessage { message?: string }
interface MssqlRequestLike {
  on(event: 'info', cb: (m: InfoMessage) => void): void;
  input(name: string, type: unknown, value: unknown): void;
  execute(name: string): Promise<{ recordsets?: unknown[] }>;
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
  if (target.kind === 'batch') assertNoTransactionControl(target.sql, 'mssql');
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
    const req = mk();
    current = req;
    req.on('info', (m) => { if (m?.message) infos.push(String(m.message)); });

    const started = performance.now();
    let result: { recordsets?: unknown[] };
    if (target.kind === 'procedure') {
      for (const p of target.params) {
        req.input(p.name.replace(/^@/, ''), sqlType(p.type), coerceParam(p.type, p.value));
      }
      result = await req.execute(target.name);
    } else {
      result = await req.batch(target.sql);
    }
    const wallMs = performance.now() - started;
    checkFlags();

    const stats = parseMssqlStatistics(infos.join('\n'));
    stats.plan = extractPlans(result.recordsets);
    stats.messages = infos.filter((m) => !NOISE.test(m));
    // Wall time is a real measurement, used only when the server reported no timing.
    if (stats.totalElapsedMs === null) stats.totalElapsedMs = Math.round(wallMs);
    return { stats, warnings };
  } catch (err) {
    if (err instanceof ExecAbortError || err instanceof ExecTimeoutError) throw err;
    if (aborted) throw new ExecAbortError();
    if (timedOut || (err as { code?: string })?.code === 'ETIMEOUT') throw new ExecTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    disposeAbort();
    // D-005: a batch never commits.
    if (tx && txAttempted) { try { await tx.rollback(); } catch { /* no active transaction */ } }
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
