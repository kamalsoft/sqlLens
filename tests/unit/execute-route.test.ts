import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-exec-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

const ex = vi.hoisted(() => ({ mssql: vi.fn(), pg: vi.fn() }));
vi.mock('@/lib/execution/mssql', () => ({ executeMssql: ex.mssql, testMssqlConnection: vi.fn() }));
vi.mock('@/lib/execution/postgres', () => ({ executePostgres: ex.pg, testPostgresConnection: vi.fn() }));

import db from '@/db';
import { POST as execute } from '@/app/api/execute/route';
import { resetRateLimits } from '@/lib/request-guard';
import { ExecTimeoutError } from '@/lib/execution/types';
import { createTestSession } from '../helpers/auth';

const PASSWORD = 'Sup3rSecret!';
const connection = { host: 'db.example.com', database: 'app', username: 'svc_user', password: PASSWORD };
const post = (body: unknown, cookie?: string, raw?: string) =>
  new Request('http://localhost/api/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}) },
    body: raw ?? JSON.stringify(body),
  });
const setLive = (allow: boolean) => writeFileSync(cfgPath, JSON.stringify({ allowLiveExecution: allow }));
const stats = (reads: number | null) => ({
  parseAndCompileTime: 1, parseAndCompileCpu: 1, executionTime: 8, executionCpu: 6, totalElapsedMs: 9,
  io: reads === null ? [] : [{ table: 'T', scanCount: 1, logicalReads: reads, physicalReads: 0, readAheadReads: 0, lobLogicalReads: 0, lobPhysicalReads: 0, lobReadAheadReads: 0 }],
  messages: [], rawOutput: '', plan: null, simulated: false,
});
const real = (extra: Record<string, unknown> = {}) => ({
  mode: 'single', engine: 'mssql', connection,
  original: { kind: 'procedure', name: 'dbo.GetOrders', params: [{ name: '@Id', type: 'int', value: 3 }] }, ...extra,
});

let cookie: string;
beforeEach(() => {
  resetRateLimits();
  setLive(false);
  cookie = createTestSession();
  ex.mssql.mockReset();
  ex.pg.mockReset();
  vi.restoreAllMocks();
});

describe('POST /api/execute', () => {
  it('401 without a session (no anonymous fallback)', async () => {
    const res = await execute(post(real()));
    expect(res.status).toBe(401);
  });

  it('429 after 10 requests per session', async () => {
    const body = { mode: 'single', engine: 'simulation', original: { kind: 'batch', sql: 'SELECT 1' } };
    for (let i = 0; i < 10; i++) expect((await execute(post(body, cookie))).status).toBe(200);
    expect((await execute(post(body, cookie))).status).toBe(429);
  });

  it('400 on bad JSON, bad mode, unknown engine, bad identifiers, bad SQL, bad param', async () => {
    expect((await execute(post(null, cookie, '{nope'))).status).toBe(400);
    expect((await execute(post({ ...real(), mode: 'x' }, cookie))).status).toBe(400);
    expect((await execute(post({ ...real(), engine: 'oracle' }, cookie))).status).toBe(400);
    const badName = await execute(post(real({ original: { kind: 'procedure', name: 'dbo.x;DROP', params: [] } }), cookie));
    expect(badName.status).toBe(400);
    expect((await badName.json()).field).toBe('original.name');
    const badParam = await execute(post(real({ original: { kind: 'procedure', name: 'p', params: [{ name: '@a b', type: 'int', value: 1 }] } }), cookie));
    expect(badParam.status).toBe(400);
    expect((await execute(post(real({ original: { kind: 'procedure', name: 'p', params: [{ name: 'a', type: 'int', value: 'abc' }] } }), cookie))).status).toBe(400);
    expect((await execute(post({ mode: 'single', engine: 'simulation', original: { kind: 'batch', sql: '   ' } }, cookie))).status).toBe(400);
    expect((await execute(post({ mode: 'compare', engine: 'simulation', original: { kind: 'batch', sql: 'SELECT 1' } }, cookie))).status).toBe(400);
    expect((await execute(post({ ...real(), connection: undefined }, cookie))).status).toBe(400);
    expect(ex.mssql).not.toHaveBeenCalled();
  });

  it('403 for a real engine while live execution is disabled', async () => {
    const res = await execute(post(real(), cookie));
    expect(res.status).toBe(403);
    expect(ex.mssql).not.toHaveBeenCalled();
  });

  it('200 simulation is labeled simulated and persisted with the flag', async () => {
    const res = await execute(post({ mode: 'single', engine: 'simulation', original: { kind: 'batch', sql: 'SELECT * FROM Orders' } }, cookie));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.simulated).toBe(true);
    expect(json.result.execution.stats.simulated).toBe(true);
    expect(typeof json.recordNumber).toBe('number');
    expect(json).not.toHaveProperty('sharedToken');
    const row = db.prepare('SELECT engine, simulated, status, shared_token FROM audit_requests WHERE id = ?').get(json.id) as Record<string, unknown>;
    expect(row).toMatchObject({ engine: 'simulation', simulated: 1, status: 'ok', shared_token: null });
  });

  it('simulation accepts a procedure target', async () => {
    const res = await execute(post({ mode: 'single', engine: 'simulation', original: { kind: 'procedure', name: 'dbo.p', params: [] } }, cookie));
    expect(res.status).toBe(200);
  });

  it('live run: persists metadata, never the password or username', async () => {
    setLive(true);
    ex.mssql.mockResolvedValue({ stats: stats(120), warnings: ['TLS verification disabled'] });
    const res = await execute(post(real({ connection: { ...connection, trustServerCertificate: true } }), cookie));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.simulated).toBe(false);
    expect(json.result.warnings).toEqual(['TLS verification disabled']);
    const row = db.prepare('SELECT request_payload, response_payload, elapsed_ms, logical_reads FROM audit_requests WHERE id = ?').get(json.id) as Record<string, unknown>;
    const payload = String(row.request_payload);
    expect(payload).not.toContain(PASSWORD);
    expect(payload).not.toContain('svc_user');
    expect(JSON.parse(payload)).toMatchObject({ engine: 'mssql', host: 'db.example.com', database: 'app' });
    expect(String(row.response_payload)).not.toContain(PASSWORD);
    expect(row).toMatchObject({ elapsed_ms: 9, logical_reads: 120 });
    // The driver received the credentials, the audit did not.
    expect(ex.mssql.mock.calls[0][0].password).toBe(PASSWORD);
  });

  it('driver errors are scrubbed and nothing sensitive reaches console.error', async () => {
    setLive(true);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ex.mssql.mockRejectedValue(new Error(`Login failed for user svc_user password ${PASSWORD} on db.example.com`));
    const res = await execute(post(real(), cookie));
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('svc_user');
    expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
    const rows = db.prepare('SELECT request_payload, response_payload, status FROM audit_requests ORDER BY rowid DESC LIMIT 1').get() as Record<string, string>;
    expect(rows.response_payload).not.toContain(PASSWORD);
    expect(rows.status).toBe('error');
  });

  it('timeout becomes 504 "Query timed out"', async () => {
    setLive(true);
    ex.pg.mockRejectedValue(new ExecTimeoutError());
    const res = await execute(post(real({ engine: 'postgres' }), cookie));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'Query timed out' });
  });

  it('forwards request.signal to the driver', async () => {
    setLive(true);
    ex.mssql.mockResolvedValue({ stats: stats(null), warnings: [] });
    await execute(post(real(), cookie));
    expect(ex.mssql.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
    expect(ex.mssql.mock.calls[0][2].timeoutMs).toBe(30000);
  });

  it('null logical reads stay null when no IO was captured', async () => {
    setLive(true);
    ex.mssql.mockResolvedValue({ stats: stats(null), warnings: [] });
    const json = await (await execute(post(real(), cookie))).json();
    const row = db.prepare('SELECT logical_reads FROM audit_requests WHERE id = ?').get(json.id) as Record<string, unknown>;
    expect(row.logical_reads).toBeNull();
  });

  it('accepts the deprecated legacy UI shape', async () => {
    const res = await execute(post({
      mode: 'compare', originalSP: 'SELECT * FROM A', optimizedSP: 'SELECT id FROM A',
      connection: { engine: 'simulation', host: '', port: null, database: '', username: '', password: '' },
    }, cookie));
    expect(res.status).toBe(200);
    expect((await res.json()).result.mode).toBe('compare');
  });
});
