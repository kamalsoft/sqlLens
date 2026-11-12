import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-databases-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

const mock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/execution/mssql', () => ({
  listDatabases: mock.list, getProcedureDefinition: vi.fn(), listProcedureParams: vi.fn(), executeMssql: vi.fn(), testMssqlConnection: vi.fn(),
}));

import { POST as databases } from '@/app/api/execute/databases/route';
import { ExecTimeoutError } from '@/lib/execution/types';
import { resetRateLimits } from '@/lib/request-guard';
import { createTestSession } from '../helpers/auth';

const connection = { host: 'db.example.com', database: 'app', username: 'svc_user', password: 'Sup3rSecret!' };
const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/execute/databases', {
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
  mock.list.mockReset();
});

describe('POST /api/execute/databases (DB-1)', () => {
  const windows = { ...connection, database: '', authType: 'windows', domain: 'CORP' };

  it('401 without a session', async () => {
    expect((await databases(post({ engine: 'mssql', connection }))).status).toBe(401);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('403 when live execution is off, before any connection', async () => {
    setLive(false);
    expect((await databases(post({ engine: 'mssql', connection }, cookie))).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it.each(['postgres', 'simulation'])('400 for the %s engine', async (engine) => {
    expect((await databases(post({ engine, connection }, cookie))).status).toBe(400);
  });

  it('400 for Windows authentication without a domain, without connecting', async () => {
    const res = await databases(post({ engine: 'mssql', connection: { ...windows, domain: undefined } }, cookie));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('connection.domain');
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('lists the databases with no database chosen yet, and passes the Windows login on', async () => {
    mock.list.mockResolvedValue(['master', 'TestDB']);
    const res = await databases(post({ engine: 'mssql', connection: windows }, cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ databases: ['master', 'TestDB'] });
    expect(mock.list.mock.calls[0][0]).toMatchObject({ database: '', authType: 'windows', domain: 'CORP' });
  });

  it('504 on timeout', async () => {
    mock.list.mockRejectedValue(new ExecTimeoutError());
    expect((await databases(post({ engine: 'mssql', connection }, cookie))).status).toBe(504);
  });

  it('502 with a login hint for ELOGIN, never echoing the driver text', async () => {
    mock.list.mockRejectedValue(Object.assign(new Error("Login failed for user 'CORP\\svc_user' at db.example.com"), { code: 'ELOGIN' }));
    const res = await databases(post({ engine: 'mssql', connection: windows }, cookie));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/Login failed\. Check the authentication type/);
    expect(text).not.toMatch(/svc_user|db\.example\.com|CORP|Sup3rSecret/);
  });

  it('429 after 10 requests per session', async () => {
    mock.list.mockResolvedValue([]);
    for (let i = 0; i < 10; i++) expect((await databases(post({ engine: 'mssql', connection }, cookie))).status).toBe(200);
    expect((await databases(post({ engine: 'mssql', connection }, cookie))).status).toBe(429);
  });
});
