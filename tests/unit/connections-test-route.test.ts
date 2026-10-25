import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-conn-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

const d = vi.hoisted(() => ({ mssql: vi.fn(), pg: vi.fn() }));
vi.mock('@/lib/execution/mssql', () => ({ executeMssql: vi.fn(), testMssqlConnection: d.mssql }));
vi.mock('@/lib/execution/postgres', () => ({ executePostgres: vi.fn(), testPostgresConnection: d.pg }));

import { POST as testConn } from '@/app/api/connections/test/route';
import { resetRateLimits } from '@/lib/request-guard';
import { ExecTimeoutError } from '@/lib/execution/types';
import { createTestSession } from '../helpers/auth';

const PASSWORD = 'Sup3rSecret!';
const connection = { host: 'db.example.com', database: 'app', username: 'svc_user', password: PASSWORD };
const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/connections/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const setLive = (allow: boolean) => writeFileSync(cfgPath, JSON.stringify({ allowLiveExecution: allow }));

let cookie: string;
beforeEach(() => {
  resetRateLimits();
  setLive(true);
  cookie = createTestSession();
  d.mssql.mockReset();
  d.pg.mockReset();
  vi.restoreAllMocks();
});

describe('POST /api/connections/test', () => {
  it('401 without a session', async () => {
    expect((await testConn(post({ engine: 'mssql', connection }))).status).toBe(401);
  });
  it('403 when live execution is disabled', async () => {
    setLive(false);
    expect((await testConn(post({ engine: 'mssql', connection }, cookie))).status).toBe(403);
    expect(d.mssql).not.toHaveBeenCalled();
  });
  it('400 on simulation engine or bad connection', async () => {
    expect((await testConn(post({ engine: 'simulation', connection }, cookie))).status).toBe(400);
    expect((await testConn(post({ engine: 'mssql', connection: { ...connection, host: 'a b;' } }, cookie))).status).toBe(400);
  });
  it('200 returns version and encryption, never credentials', async () => {
    d.pg.mockResolvedValue({ serverVersion: '16.2', encrypted: true, warnings: [] });
    const res = await testConn(post({ engine: 'postgres', connection }, cookie));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, engine: 'postgres', serverVersion: '16.2', encrypted: true });
    expect(text).not.toContain(PASSWORD);
    expect(d.pg.mock.calls[0][1]).toBe(5000);
  });
  it('504 on timeout', async () => {
    d.mssql.mockRejectedValue(new ExecTimeoutError());
    const res = await testConn(post({ engine: 'mssql', connection }, cookie));
    expect(res.status).toBe(504);
  });
  it('502 generic on failure, nothing sensitive logged or returned', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    d.mssql.mockRejectedValue(new Error(`Login failed for svc_user: ${PASSWORD}`));
    const res = await testConn(post({ engine: 'mssql', connection }, cookie));
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(PASSWORD);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
  });
});
