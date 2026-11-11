import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-definition-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

const mock = vi.hoisted(() => ({ definition: vi.fn() }));
vi.mock('@/lib/execution/mssql', () => ({
  getProcedureDefinition: mock.definition, listProcedureParams: vi.fn(), executeMssql: vi.fn(), testMssqlConnection: vi.fn(),
}));

import { POST as definition } from '@/app/api/execute/definition/route';
import { ExecTimeoutError } from '@/lib/execution/types';
import { resetRateLimits } from '@/lib/request-guard';
import { createTestSession } from '../helpers/auth';

const connection = { host: 'db.example.com', database: 'app', username: 'svc_user', password: 'Sup3rSecret!' };
const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/execute/definition', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const setLive = (allow: boolean) => writeFileSync(cfgPath, JSON.stringify({ allowLiveExecution: allow }));
const TEXT = 'CREATE PROCEDURE dbo.p AS SELECT 1';

let cookie: string;
beforeEach(() => {
  resetRateLimits();
  setLive(true);
  cookie = createTestSession();
  mock.definition.mockReset();
});

describe('POST /api/execute/definition (RF-5)', () => {
  it('401 without a session', async () => {
    expect((await definition(post({ engine: 'mssql', name: 'dbo.p', connection }))).status).toBe(401);
    expect(mock.definition).not.toHaveBeenCalled();
  });

  it('403 when live execution is off, before any connection', async () => {
    setLive(false);
    expect((await definition(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie))).status).toBe(403);
    expect(mock.definition).not.toHaveBeenCalled();
  });

  it.each(['dbo.p; DROP TABLE x', '[dbo].[p]', "dbo.p'x", 'a.b.c', 'dbo.p--', ''])('400 for the name %j, without connecting', async (name) => {
    expect((await definition(post({ engine: 'mssql', name, connection }, cookie))).status).toBe(400);
    expect(mock.definition).not.toHaveBeenCalled();
  });

  it.each(['postgres', 'simulation'])('400 for the %s engine', async (engine) => {
    expect((await definition(post({ engine, name: 'dbo.p', connection }, cookie))).status).toBe(400);
    expect(mock.definition).not.toHaveBeenCalled();
  });

  it('400 without a valid connection', async () => {
    expect((await definition(post({ engine: 'mssql', name: 'dbo.p' }, cookie))).status).toBe(400);
  });

  it('returns the definition for the trimmed name', async () => {
    mock.definition.mockResolvedValue(TEXT);
    const res = await definition(post({ engine: 'mssql', name: ' dbo.p\n', connection }, cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ definition: TEXT });
    expect(mock.definition.mock.calls[0][1]).toBe('dbo.p');
  });

  it('404 when there is no readable definition', async () => {
    mock.definition.mockResolvedValue(null);
    const res = await definition(post({ engine: 'mssql', name: 'dbo.nope', connection }, cookie));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/VIEW DEFINITION/);
  });

  it('504 on timeout', async () => {
    mock.definition.mockRejectedValue(new ExecTimeoutError());
    expect((await definition(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie))).status).toBe(504);
  });

  it('502 with a generic message that does not echo the driver error', async () => {
    mock.definition.mockRejectedValue(Object.assign(new Error('Login failed for user svc_user at db.example.com'), { code: 'ELOGIN' }));
    const res = await definition(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/svc_user|db\.example\.com|Login failed|Sup3rSecret/);
  });

  it('429 after 10 requests per session', async () => {
    mock.definition.mockResolvedValue(TEXT);
    for (let i = 0; i < 10; i++) expect((await definition(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie))).status).toBe(200);
    expect((await definition(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie))).status).toBe(429);
  });
});
