import { describe, expect, it } from 'vitest';
import { parseExecuteRequest } from '@/lib/execution/request';

const conn = { host: 'localhost', port: 1433, database: 'TestDB', username: 'sa', password: 'x' };
const body = (engine: string, param: Record<string, unknown>) => ({
  mode: 'single', engine, connection: conn,
  original: { kind: 'procedure', name: 'dbo.p', params: [param] },
});

describe('OUTPUT parameter validation', () => {
  it('accepts an OUTPUT parameter on MSSQL with a null value', () => {
    const r = parseExecuteRequest(body('mssql', { name: '@ExecutionLogID', type: 'int', value: null, output: true }), 100000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.original).toMatchObject({ params: [{ name: '@ExecutionLogID', output: true }] });
  });

  it('leaves input parameters without an output flag', () => {
    const r = parseExecuteRequest(body('mssql', { name: '@RegionID', type: 'int', value: 1 }), 100000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.original).toMatchObject({ params: [{ name: '@RegionID' }] });
    if (r.ok) expect('output' in (r.value.original as { params: object[] }).params[0]).toBe(false);
  });

  it('rejects OUTPUT on PostgreSQL', () => {
    const r = parseExecuteRequest(body('postgres', { name: '@x', type: 'int', value: null, output: true }), 100000);
    expect(r).toMatchObject({ ok: false, field: 'original.params[0].output' });
  });

  it('rejects a non-boolean output flag', () => {
    const r = parseExecuteRequest(body('mssql', { name: '@x', type: 'int', value: 1, output: 'yes' }), 100000);
    expect(r).toMatchObject({ ok: false, field: 'original.params[0].output' });
  });
});
