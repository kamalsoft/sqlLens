import { validateSqlInput } from '../validation/sql-input';
import { isBoolean, isNumber, isString } from '../validation/body';
import { assertNoTransactionControl } from './sql-scan';
import {
  coerceParam, ExecRejectedError, IDENT_RE, PARAM_NAME_RE, PARAM_TYPES,
  type EngineName, type ExecConnection, type ExecParam, type ExecTarget, type ParamType,
} from './types';

export interface ExecuteRequest {
  mode: 'single' | 'compare';
  engine: EngineName;
  connection?: ExecConnection;
  original: ExecTarget;
  optimized?: ExecTarget;
}
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };
const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field });
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

const HOST_RE = /^[A-Za-z0-9._:\-[\]]{1,255}$/;

export function parseConnection(raw: unknown, field = 'connection'): Parsed<ExecConnection> {
  if (!isObj(raw)) return fail('connection is required for a real engine', field);
  const { host, port, database, username, password, encrypt, trustServerCertificate } = raw;
  if (!isString(host) || !HOST_RE.test(host)) return fail('host is invalid', `${field}.host`);
  if (port !== undefined && port !== null && !(isNumber(port) && Number.isInteger(port) && port >= 1 && port <= 65535)) {
    return fail('port must be an integer between 1 and 65535', `${field}.port`);
  }
  if (!isString(database) || database.length === 0 || database.length > 128 || database.includes('\0')) {
    return fail('database is invalid', `${field}.database`);
  }
  if (!isString(username) || username.length === 0 || username.length > 256 || username.includes('\0')) {
    return fail('username is invalid', `${field}.username`);
  }
  if (!isString(password) || password.length > 1024 || password.includes('\0')) {
    return fail('password is invalid', `${field}.password`);
  }
  if (encrypt !== undefined && !isBoolean(encrypt)) return fail('encrypt must be a boolean', `${field}.encrypt`);
  if (trustServerCertificate !== undefined && !isBoolean(trustServerCertificate)) {
    return fail('trustServerCertificate must be a boolean', `${field}.trustServerCertificate`);
  }
  return {
    ok: true,
    value: {
      host, database, username, password,
      ...(isNumber(port) ? { port } : {}),
      ...(encrypt !== undefined ? { encrypt } : {}),
      ...(trustServerCertificate !== undefined ? { trustServerCertificate } : {}),
    },
  };
}

function parseTarget(raw: unknown, field: string, engine: EngineName, maxSqlLength: number): Parsed<ExecTarget> {
  if (!isObj(raw)) return fail(`${field} is required`, field);
  if (raw.kind === 'batch') {
    const v = validateSqlInput(raw.sql, maxSqlLength);
    if (!v.ok) return fail(v.error, `${field}.sql`);
    if (engine !== 'simulation') {
      try { assertNoTransactionControl(v.sql, engine); } catch (e) {
        if (e instanceof ExecRejectedError) return fail(e.message, `${field}.sql`);
        throw e;
      }
    }
    return { ok: true, value: { kind: 'batch', sql: v.sql } };
  }
  if (raw.kind === 'procedure') {
    if (!isString(raw.name) || !IDENT_RE.test(raw.name) || raw.name.length > 128) {
      return fail('Invalid procedure name', `${field}.name`);
    }
    if (!Array.isArray(raw.params)) return fail('params must be an array', `${field}.params`);
    if (raw.params.length > 100) return fail('Too many parameters', `${field}.params`);
    const params: ExecParam[] = [];
    for (let i = 0; i < raw.params.length; i++) {
      const p: unknown = raw.params[i];
      const f = `${field}.params[${i}]`;
      if (!isObj(p)) return fail('Invalid parameter', f);
      if (!isString(p.name) || !PARAM_NAME_RE.test(p.name) || p.name.length > 128) return fail('Invalid parameter name', `${f}.name`);
      if (!isString(p.type) || !(PARAM_TYPES as readonly string[]).includes(p.type)) return fail('Invalid parameter type', `${f}.type`);
      const v = p.value;
      if (!(v === null || isString(v) || isNumber(v) || isBoolean(v))) return fail('Invalid parameter value', `${f}.value`);
      try { coerceParam(p.type as ParamType, v); } catch { return fail(`Value does not match type ${p.type}`, `${f}.value`); }
      params.push({ name: p.name, type: p.type as ParamType, value: v });
    }
    return { ok: true, value: { kind: 'procedure', name: raw.name, params } };
  }
  return fail('kind must be "procedure" or "batch"', `${field}.kind`);
}

/**
 * Parses the C12 request. Also accepts the legacy UI shape
 * `{ mode, originalSP, optimizedSP, connection: { engine, ... } }`.
 * @deprecated legacy shape: remove once frontend P2-08 ships.
 */
export function parseExecuteRequest(body: Record<string, unknown>, maxSqlLength: number): Parsed<ExecuteRequest> {
  const legacy = body.original === undefined && body.originalSP !== undefined;
  const mode = body.mode === 'compare' ? 'compare' : body.mode === 'single' ? 'single' : null;
  if (!mode) return fail('mode must be "single" or "compare"', 'mode');

  let engineRaw: unknown = body.engine;
  let connRaw: unknown = body.connection;
  let original: unknown = body.original;
  let optimized: unknown = body.optimized;
  if (legacy) {
    const c = isObj(body.connection) ? body.connection : {};
    engineRaw = c.engine ?? 'simulation';
    connRaw = c;
    original = { kind: 'batch', sql: body.originalSP };
    optimized = body.optimizedSP === undefined || body.optimizedSP === null ? undefined : { kind: 'batch', sql: body.optimizedSP };
  }
  if (engineRaw !== 'simulation' && engineRaw !== 'mssql' && engineRaw !== 'postgres') {
    return fail('engine must be simulation, mssql or postgres', 'engine');
  }
  const engine: EngineName = engineRaw;

  let connection: ExecConnection | undefined;
  if (engine !== 'simulation') {
    const c = parseConnection(connRaw);
    if (!c.ok) return c;
    connection = c.value;
  }
  const o = parseTarget(original, 'original', engine, maxSqlLength);
  if (!o.ok) return o;
  let opt: ExecTarget | undefined;
  if (mode === 'compare') {
    const t = parseTarget(optimized, 'optimized', engine, maxSqlLength);
    if (!t.ok) return t;
    opt = t.value;
  }
  return { ok: true, value: { mode, engine, connection, original: o.value, optimized: opt } };
}
