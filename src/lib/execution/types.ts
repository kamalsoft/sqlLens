import type { ExecutionStats } from '../telemetry/types';

/** Contract C12 identifier patterns. */
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
export const PARAM_NAME_RE = /^@?[A-Za-z_][A-Za-z0-9_]*$/;

export const PARAM_TYPES = [
  'int', 'bigint', 'decimal', 'nvarchar', 'varchar', 'bit', 'datetime', 'date', 'uniqueidentifier',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export type ParamValue = string | number | boolean | null;
/** `output`: MSSQL OUTPUT parameter; its value is returned in `DriverOutcome.outputs`. */
export interface ExecParam { name: string; type: ParamType; value: ParamValue; output?: boolean }

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

export interface DriverOutcome { stats: ExecutionStats; warnings: string[]; outputs?: Record<string, unknown> }

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
/** YYYY-MM-DD with an optional time (space or T separator), and no time zone. */
const NAIVE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?$/;
/** ISO 8601 with an explicit Z or ±hh:mm offset: the only text form that carries its own time zone. */
const OFFSET_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?(Z|[+-]\d{2}:\d{2})$/;

/** The UTC instant for literal components, or null when the calendar or the clock does not exist. */
function instantFrom(y: number, mo: number, d: number, hh: number, mi: number, ss: number, frac: string | undefined): Date | null {
  // Exact: the first three digits are the milliseconds (no floating-point rounding).
  const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;
  const utc = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss, ms));
  const real = utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
  return real && hh <= 23 && mi <= 59 && ss <= 59 ? utc : null;
}
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
      // DT-1: a naive date-time is taken as the literal components, never through the server's local time zone.
      if (typeof value === 'number') {
        const epoch = new Date(value);
        if (Number.isNaN(epoch.getTime())) return bad();
        return epoch;
      }
      const text = value.trim();
      const naive = NAIVE_DATETIME_RE.exec(text);
      if (naive) {
        const parts = naive.slice(1);
        const utc = instantFrom(Number(parts[0]), Number(parts[1]), Number(parts[2]), Number(parts[3] ?? 0), Number(parts[4] ?? 0), Number(parts[5] ?? 0), parts[6]);
        return utc ?? bad();
      }
      // Anything else must carry an explicit offset; without one the server's local time zone would decide.
      const offset = OFFSET_DATETIME_RE.exec(text);
      if (!offset) return bad();
      const zoneHours = offset[8] === 'Z' ? 0 : Number(offset[8].slice(1, 3));
      const zoneMinutes = offset[8] === 'Z' ? 0 : Number(offset[8].slice(4, 6));
      if (zoneHours > 14 || zoneMinutes > 59) return bad();
      const zone = (offset[8][0] === '-' ? -1 : 1) * (zoneHours * 60 + zoneMinutes);
      const local = instantFrom(Number(offset[1]), Number(offset[2]), Number(offset[3]), Number(offset[4]), Number(offset[5]), Number(offset[6] ?? 0), offset[7]);
      if (!local) return bad();
      return new Date(local.getTime() - zone * 60_000);
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
