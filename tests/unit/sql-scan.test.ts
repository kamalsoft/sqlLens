import { describe, expect, it } from 'vitest';
import { splitStatements } from '@/lib/execution/sql-scan';

describe('sql-scan', () => {
  it('splits only on top-level semicolons', () => {
    expect(splitStatements("SELECT ';'; -- a;b\nSELECT $$x;y$$; /* ; */ SELECT \"a;b\"", 'postgres')).toEqual([
      "SELECT ';'", '-- a;b\nSELECT $$x;y$$', '/* ; */ SELECT "a;b"',
    ]);
  });
});
