import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeSP } from '@/lib/sp-executor';

describe('C17 text log', () => {
  const sql = "SELECT secret_column FROM Payroll WHERE ssn = '123-45-6789'";
  const target = { kind: 'batch', sql } as const;
  let logDir: string;

  beforeEach(() => {
    logDir = mkdtempSync(path.join(os.tmpdir(), 'sqllens-log-'));
    process.env.SQLLENS_AUDIT_LOG_DIR = logDir;
  });

  afterEach(() => {
    delete process.env.SQLLENS_AUDIT_LOG_DIR;
    rmSync(logDir, { recursive: true, force: true });
  });

  /** The single audit log written by the run; the response no longer carries its path. */
  const readLog = () => readFileSync(path.join(logDir, readdirSync(logDir).find((f) => f.endsWith('.txt'))!), 'utf-8');

  it('writes the SHA-256 and length instead of SQL when logSqlText is false', async () => {
    const r = await executeSP(target, 'Original_SP', 'simulation', undefined, { timeoutMs: 1000, logSqlText: false });
    const text = readLog();
    expect(r).not.toHaveProperty('textFilePath');
    expect(text).not.toContain('secret_column');
    expect(text).toContain(`sha256=${createHash('sha256').update(sql).digest('hex')}`);
    expect(text).toContain(`length=${sql.length}`);
  });

  it('writes the SQL when logSqlText is true', async () => {
    await executeSP(target, 'Original_SP', 'simulation', undefined, { timeoutMs: 1000, logSqlText: true });
    expect(readLog()).toContain('secret_column');
  });
});

describe('scrubConnection', () => {
  it('scrubs short passwords/users as whole tokens and escapes regex chars', async () => {
    const { scrubConnection } = await import('@/lib/sp-executor');
    expect(scrubConnection("Login failed for user 'sa' pw a1", { username: 'sa', password: 'a1' }))
      .toBe("Login failed for user '[redacted]' pw [redacted]");
    expect(scrubConnection('bad pw ($', { password: '($' })).toBe('bad pw [redacted]');
    expect(scrubConnection('cannot parse password', { password: 'a' })).toBe('cannot parse password');
    expect(scrubConnection('x secret123 y', { password: 'secret123' })).toBe('x [redacted] y');
  });
});
