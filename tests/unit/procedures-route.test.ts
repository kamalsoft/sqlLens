import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-procedures-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

const mock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/execution/mssql', () => ({
  listProcedures: mock.list, getProcedureDefinition: vi.fn(), listProcedureParams: vi.fn(), executeMssql: vi.fn(), testMssqlConnection: vi.fn(),
}));

import { POST as procedures } from '@/app/api/execute/procedures/route';
import { ExecTimeoutError } from '@/lib/execution/types';
import { resetRateLimits } from '@/lib/request-guard';
import { createTestSession } from '../helpers/auth';

const connection = { host: 'db.example.com', database: 'app', username: 'svc_user', password: 'Sup3rSecret!' };
const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/execute/procedures', {
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

describe('POST /api/execute/procedures', () => {
  it('401 without a session', async () => {
    expect((await procedures(post({ engine: 'mssql', connection }))).status).toBe(401);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('403 when live execution is off, before any connection', async () => {
    setLive(false);
    expect((await procedures(post({ engine: 'mssql', connection }, cookie))).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it.each(['postgres', 'simulation'])('400 for the %s engine', async (engine) => {
    expect((await procedures(post({ engine, connection }, cookie))).status).toBe(400);
  });

  it('400 without a database: procedures belong to one database', async () => {
    const res = await procedures(post({ engine: 'mssql', connection: { ...connection, database: '' } }, cookie));
    expect(res.status).toBe(400);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('lists the procedures of the chosen database', async () => {
    mock.list.mockResolvedValue(['dbo.usp_A', 'dbo.usp_B']);
    const res = await procedures(post({ engine: 'mssql', connection }, cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ procedures: ['dbo.usp_A', 'dbo.usp_B'] });
    expect(mock.list.mock.calls[0][0]).toMatchObject({ database: 'app' });
  });

  it('504 on timeout', async () => {
    mock.list.mockRejectedValue(new ExecTimeoutError());
    expect((await procedures(post({ engine: 'mssql', connection }, cookie))).status).toBe(504);
  });

  it('502 without echoing the driver text', async () => {
    mock.list.mockRejectedValue(Object.assign(new Error('Login failed for user svc_user at db.example.com'), { code: 'ELOGIN' }));
    const res = await procedures(post({ engine: 'mssql', connection }, cookie));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/svc_user|db\.example\.com|Sup3rSecret/);
  });

  it('429 after 10 requests per session', async () => {
    mock.list.mockResolvedValue([]);
    for (let i = 0; i < 10; i++) expect((await procedures(post({ engine: 'mssql', connection }, cookie))).status).toBe(200);
    expect((await procedures(post({ engine: 'mssql', connection }, cookie))).status).toBe(429);
  });
});
