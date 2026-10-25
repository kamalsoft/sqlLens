import pg from 'pg';
import { parsePostgresPlan } from '../telemetry/postgres';
import type { ExecutionStats } from '../telemetry/types';
import { assertNoTransactionControl, firstKeyword, splitStatements } from './sql-scan';
import {
  coerceParam, ExecAbortError, ExecTimeoutError, isLocalHost, onAbort, TLS_WARNING,
  type DriverOutcome, type ExecConnection, type ExecOptions, type ExecTarget, type ParamType,
} from './types';

interface PgClientLike {
  processID?: number;
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

const PG_CAST: Record<ParamType, string> = {
  int: 'integer', bigint: 'bigint', decimal: 'numeric', nvarchar: 'text', varchar: 'text',
  bit: 'boolean', datetime: 'timestamp', date: 'date', uniqueidentifier: 'uuid',
};
const EXPLAINABLE = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

/** Built connection options (P6-08): TLS with verification for every non-loopback host. */
export function buildPgConfig(conn: ExecConnection, timeoutMs: number) {
  const local = isLocalHost(conn.host);
  const warnings: string[] = [];
  let ssl: false | { rejectUnauthorized: boolean } | undefined;
  if (conn.encrypt === false) {
    ssl = false;
    if (!local) warnings.push(TLS_WARNING);
  } else if (conn.trustServerCertificate === true && (!local || conn.encrypt === true)) {
    ssl = { rejectUnauthorized: false };
    warnings.push(TLS_WARNING);
  } else if (!local || conn.encrypt === true) {
    ssl = { rejectUnauthorized: true };
  }
  return {
    config: {
      host: conn.host,
      port: conn.port ?? 5432,
      database: conn.database,
      user: conn.username,
      password: conn.password,
      connectionTimeoutMillis: Math.min(timeoutMs, 15_000),
      ...(ssl === undefined ? {} : { ssl }),
    },
    warnings,
  };
}

function bindValue(type: ParamType, value: ExecParamValue): unknown {
  const v = coerceParam(type, value);
  return v instanceof Date ? v.toISOString() : v;
}
type ExecParamValue = string | number | boolean | null;

function planText(row: Record<string, unknown> | undefined): string {
  const v = row ? (row['QUERY PLAN'] ?? Object.values(row)[0]) : undefined;
  return typeof v === 'string' ? v : JSON.stringify(v ?? null);
}

const sumNullable = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

function mergeStats(parts: ExecutionStats[], plans: string[]): ExecutionStats {
  const out: ExecutionStats = {
    parseAndCompileTime: null, parseAndCompileCpu: null, executionTime: null, executionCpu: null,
    totalElapsedMs: null, io: [], messages: [], rawOutput: '', plan: null, simulated: false,
  };
  for (const s of parts) {
    out.parseAndCompileTime = sumNullable(out.parseAndCompileTime, s.parseAndCompileTime);
    out.executionTime = sumNullable(out.executionTime, s.executionTime);
    out.totalElapsedMs = sumNullable(out.totalElapsedMs, s.totalElapsedMs);
    out.io.push(...s.io);
    out.messages.push(...s.messages);
    out.rawOutput += (out.rawOutput ? '\n' : '') + s.rawOutput;
  }
  out.plan = plans.length ? (plans.length === 1 ? plans[0] : `[${plans.join(',')}]`) : null;
  return out;
}

function timingOnly(ms: number, note: string): ExecutionStats {
  return {
    parseAndCompileTime: null, parseAndCompileCpu: null, executionTime: null, executionCpu: null,
    totalElapsedMs: Math.round(ms), io: [], messages: [note], rawOutput: note, plan: null, simulated: false,
  };
}

export async function executePostgres(
  conn: ExecConnection, target: ExecTarget, opts: ExecOptions,
): Promise<DriverOutcome> {
  if (target.kind === 'batch') assertNoTransactionControl(target.sql, 'postgres');
  const { config, warnings } = buildPgConfig(conn, opts.timeoutMs);
  const client: PgClientLike = new pg.Client(config);
  let aborted = false;
  let timedOut = false;
  let connected = false;
  let inTx = false;

  // pg 8.x has no per-query cancel on a Client; cancel the backend from a second short-lived client.
  const cancel = async () => {
    if (!connected || client.processID === undefined) return;
    const killer: PgClientLike = new pg.Client({ ...config, connectionTimeoutMillis: 5000 });
    try {
      await killer.connect();
      await killer.query('SELECT pg_cancel_backend($1)', [client.processID]);
    } catch { /* best effort */ } finally {
      try { await killer.end(); } catch { /* ignore */ }
    }
  };
  const disposeAbort = onAbort(opts.signal, () => { aborted = true; void cancel(); });
  const timer = setTimeout(() => { timedOut = true; void cancel(); }, opts.timeoutMs);
  const checkFlags = () => {
    if (aborted) throw new ExecAbortError();
    if (timedOut) throw new ExecTimeoutError();
  };

  try {
    if (opts.signal?.aborted) { aborted = true; checkFlags(); }
    await client.connect();
    connected = true;
    checkFlags();
    await client.query("SELECT set_config('statement_timeout', $1, false)", [String(Math.trunc(opts.timeoutMs))]);

    if (target.kind === 'procedure') {
      // D-024 A: CALL cannot be EXPLAINed, so a procedure reports wall-clock timing only.
      const placeholders = target.params.map((p, i) => `$${i + 1}::${PG_CAST[p.type]}`).join(', ');
      const values = target.params.map((p) => bindValue(p.type, p.value));
      const t0 = performance.now();
      await client.query(`CALL ${target.name}(${placeholders})`, values);
      const stats = timingOnly(performance.now() - t0, 'Procedure timing only: EXPLAIN is not available for CALL');
      checkFlags();
      return { stats, warnings };
    }

    await client.query('BEGIN');
    inTx = true;
    const parts: ExecutionStats[] = [];
    const plans: string[] = [];
    for (const stmt of splitStatements(target.sql, 'postgres')) {
      checkFlags();
      if (EXPLAINABLE.has(firstKeyword(stmt, 'postgres'))) {
        // EXPLAIN ANALYZE executes the statement once, inside the transaction that is rolled back below.
        const r = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${stmt}`);
        const text = planText(r.rows[0]);
        parts.push(parsePostgresPlan(text));
        plans.push(text);
      } else {
        const t0 = performance.now();
        await client.query(stmt);
        parts.push(timingOnly(performance.now() - t0, 'Statement timing only'));
      }
    }
    checkFlags();
    return { stats: mergeStats(parts, plans), warnings };
  } catch (err) {
    if (err instanceof ExecAbortError || err instanceof ExecTimeoutError) throw err;
    if (aborted) throw new ExecAbortError();
    if (timedOut) throw new ExecTimeoutError();
    if ((err as { code?: string })?.code === '57014') throw new ExecTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    disposeAbort();
    // D-005: a batch never commits.
    if (inTx) { try { await client.query('ROLLBACK'); } catch { /* connection lost */ } }
    try { await client.end(); } catch { /* ignore */ }
  }
}

export async function testPostgresConnection(
  conn: ExecConnection, timeoutMs: number,
): Promise<{ serverVersion: string | null; encrypted: boolean; warnings: string[] }> {
  const { config, warnings } = buildPgConfig(conn, timeoutMs);
  const client: PgClientLike = new pg.Client(config);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = (async () => {
      await client.connect();
      const r = await client.query('SHOW server_version');
      const v = r.rows[0]?.server_version;
      return typeof v === 'string' ? v : null;
    })();
    run.catch(() => {});
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ExecTimeoutError()), timeoutMs); });
    const serverVersion = await Promise.race([run, limit]);
    return { serverVersion, encrypted: 'ssl' in config && config.ssl !== false, warnings };
  } finally {
    if (timer) clearTimeout(timer);
    try { await client.end(); } catch { /* ignore */ }
  }
}
