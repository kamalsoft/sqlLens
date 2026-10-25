import { describe, expect, it } from 'vitest';
import { assertNoTransactionControl, splitStatements } from '@/lib/execution/sql-scan';

describe('sql-scan', () => {
  it('splits only on top-level semicolons', () => {
    expect(splitStatements("SELECT ';'; -- a;b\nSELECT $$x;y$$; /* ; */ SELECT \"a;b\"", 'postgres')).toEqual([
      "SELECT ';'", '-- a;b\nSELECT $$x;y$$', '/* ; */ SELECT "a;b"',
    ]);
  });
  it('does not let an E-string backslash hide a COMMIT', () => {
    expect(() => assertNoTransactionControl("SELECT E'\\''; COMMIT; --'", 'postgres')).toThrow();
  });
  it('allows the word commit inside strings and comments', () => {
    expect(() => assertNoTransactionControl("SELECT 'commit' -- commit", 'postgres')).not.toThrow();
    expect(() => assertNoTransactionControl("SELECT 'commit' /* rollback */", 'mssql')).not.toThrow();
  });
  it('rejects mssql COMMIT and ROLLBACK', () => {
    expect(() => assertNoTransactionControl('UPDATE t SET a=1\nCOMMIT TRAN', 'mssql')).toThrow();
    expect(() => assertNoTransactionControl('rollback', 'mssql')).toThrow();
  });
});
