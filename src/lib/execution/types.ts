import type { ExecutionStats } from '../telemetry/types';

/** Contract C12 identifier patterns. */
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
export const PARAM_NAME_RE = /^@?[A-Za-z_][A-Za-z0-9_]*$/;

export const PARAM_TYPES = [
  'int', 'bigint', 'decimal', 'nvarchar', 'varchar', 'bit', 'datetime', 'date', 'uniqueidentifier',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export type ParamValue = string | number | boolean | null;
export interface ExecParam { name: string; type: ParamType; value: ParamValue }

export type ExecTarget =
  | { kind: 'procedure'; name: string; params: ExecParam[] }
  | { kind: 'batch'; sql: string };

export type RealEngine = 'mssql' | 'postgres';
export type EngineName = RealEngine | 'simulation';

export interface ExecConnection {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export interface ExecOptions { timeoutMs: number; signal?: AbortSignal }

export interface DriverOutcome { stats: ExecutionStats; warnings: string[] }

export const TLS_WARNING = 'TLS verification disabled';

export class ExecTimeoutError extends Error {
  constructor() { super('Query timed out'); this.name = 'ExecTimeoutError'; }
}
export class ExecAbortError extends Error {
  constructor() { super('Execution aborted'); this.name = 'ExecAbortError'; }
}
export class ExecRejectedError extends Error {
  constructor(message: string) { super(message); this.name = 'ExecRejectedError'; }
}

export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

const INT_RE = /^-?\d+$/;
const DEC_RE = /^-?\d+(\.\d+)?$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Validate and normalise a parameter value for its declared type. Throws RangeError. */
export function coerceParam(type: ParamType, value: ParamValue): string | number | boolean | Date | null {
  if (value === null) return null;
  const bad = (): never => { throw new RangeError(`Invalid value for ${type}`); };
  switch (type) {
    case 'int': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && INT_RE.test(value.trim()) ? Number(value) : NaN;
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) bad();
      return n;
    }
    case 'bigint': {
      if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
      if (typeof value === 'string' && INT_RE.test(value.trim())) return value.trim();
      return bad();
    }
    case 'decimal': {
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      if (typeof value === 'string' && DEC_RE.test(value.trim())) return value.trim();
      return bad();
    }
    case 'bit': {
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      return bad();
    }
    case 'datetime':
    case 'date': {
      if (typeof value !== 'string' && typeof value !== 'number') return bad();
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) bad();
      return d;
    }
    case 'uniqueidentifier': {
      if (typeof value === 'string' && UUID_RE.test(value)) return value;
      return bad();
    }
    default:
      return String(value);
  }
}

/** Run `fn` (cancel hook) when the signal aborts. Returns a disposer. */
export function onAbort(signal: AbortSignal | undefined, fn: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener('abort', fn, { once: true });
  return () => signal.removeEventListener('abort', fn);
}
