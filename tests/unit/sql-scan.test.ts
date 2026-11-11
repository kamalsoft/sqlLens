import { describe, expect, it } from 'vitest';
import { splitGoBatches, splitStatements } from '@/lib/execution/sql-scan';

describe('sql-scan', () => {
  it('splits SSMS GO separators into batches', () => {
    expect(splitGoBatches('SET ANSI_NULLS ON;\r\nGO\r\nCREATE PROCEDURE p AS SELECT 1\n  go  \nSELECT 2\n')).toEqual([
      'SET ANSI_NULLS ON;', 'CREATE PROCEDURE p AS SELECT 1', 'SELECT 2',
    ]);
  });
  it('does not split on GO inside a line', () => {
    expect(splitGoBatches('SELECT \'GO\' AS x, GOAL FROM t')).toEqual(["SELECT 'GO' AS x, GOAL FROM t"]);
  });

  it('splits only on top-level semicolons', () => {
    expect(splitStatements("SELECT ';'; -- a;b\nSELECT $$x;y$$; /* ; */ SELECT \"a;b\"", 'postgres')).toEqual([
      "SELECT ';'", '-- a;b\nSELECT $$x;y$$', '/* ; */ SELECT "a;b"',
    ]);
  });
});
