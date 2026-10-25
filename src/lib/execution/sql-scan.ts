import { ExecRejectedError } from './types';

type Dialect = 'mssql' | 'postgres';

/**
 * Replace comments and quoted literals/identifiers with spaces (same length), so keyword and
 * `;` scans cannot be fooled by text inside strings. Not a full parser; defence in depth only.
 */
export function maskSql(sql: string, dialect: Dialect): string {
  const out = sql.split('');
  const n = sql.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      let j = i; while (j < n && sql[j] !== '\n') j++;
      blank(i, j); i = j;
    } else if (c === '/' && next === '*') {
      let depth = 1; let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*' && dialect === 'postgres') { depth++; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      blank(i, j); i = j;
    } else if (c === "'" || c === '"' || (c === '[' && dialect === 'mssql')) {
      const close = c === '[' ? ']' : c;
      const prev = sql[i - 1];
      const escapes = dialect === 'postgres' && c === "'" && (prev === 'E' || prev === 'e') && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === close) {
          if (sql[j + 1] === close) { j += 2; continue; }
          break;
        }
        j++;
      }
      blank(i + 1, j); i = j + 1;
    } else if (c === '$' && dialect === 'postgres') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      const prev = sql[i - 1];
      if (m && !/[A-Za-z0-9_$]/.test(prev ?? ' ')) {
        const end = sql.indexOf(m[0], i + m[0].length);
        const stop = end === -1 ? n : end;
        blank(i + m[0].length, stop); i = end === -1 ? n : stop + m[0].length;
      } else i++;
    } else i++;
  }
  return out.join('');
}

/** Split on top-level semicolons. Empty statements are dropped. */
export function splitStatements(sql: string, dialect: Dialect): string[] {
  const masked = maskSql(sql, dialect);
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ';') { parts.push(sql.slice(start, i)); start = i + 1; }
  }
  parts.push(sql.slice(start));
  return parts.map((p) => p.trim()).filter((p) => maskSql(p, dialect).trim().length > 0);
}

export function firstKeyword(statement: string, dialect: Dialect): string {
  const m = /^\s*([A-Za-z]+)/.exec(maskSql(statement, dialect));
  return m ? m[1].toUpperCase() : '';
}

const PG_TX_CONTROL = new Set(['COMMIT', 'END', 'ROLLBACK', 'ABORT', 'BEGIN', 'START', 'SAVEPOINT', 'RELEASE', 'PREPARE']);

/** Batches run inside a transaction we always roll back; a batch must not end it itself. */
export function assertNoTransactionControl(sql: string, dialect: Dialect): void {
  if (dialect === 'postgres') {
    for (const s of splitStatements(sql, dialect)) {
      if (PG_TX_CONTROL.has(firstKeyword(s, dialect))) {
        throw new ExecRejectedError('Transaction control statements are not allowed in a batch');
      }
    }
    return;
  }
  if (/\b(COMMIT|ROLLBACK)\b/i.test(maskSql(sql, dialect))) {
    throw new ExecRejectedError('Transaction control statements are not allowed in a batch');
  }
}
