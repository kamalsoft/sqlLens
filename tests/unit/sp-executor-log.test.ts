import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executeSP } from '@/lib/sp-executor';

describe('C17 text log', () => {
  const sql = "SELECT secret_column FROM Payroll WHERE ssn = '123-45-6789'";
  const target = { kind: 'batch', sql } as const;

  it('writes the SHA-256 and length instead of SQL when logSqlText is false', async () => {
    const r = await executeSP(target, 'Original_SP', 'simulation', undefined, { timeoutMs: 1000, logSqlText: false });
    const text = readFileSync(r.textFilePath, 'utf-8');
    expect(text).not.toContain('secret_column');
    expect(text).toContain(`sha256=${createHash('sha256').update(sql).digest('hex')}`);
    expect(text).toContain(`length=${sql.length}`);
  });

  it('writes the SQL when logSqlText is true', async () => {
    const r = await executeSP(target, 'Original_SP', 'simulation', undefined, { timeoutMs: 1000, logSqlText: true });
    expect(readFileSync(r.textFilePath, 'utf-8')).toContain('secret_column');
  });
});
