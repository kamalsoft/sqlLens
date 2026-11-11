import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'sqllens-params-cfg-')), 'appconfig.json');
process.env.SQLLENS_CONFIG_PATH = cfgPath;

const mock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/execution/mssql', () => ({ listProcedureParams: mock.list, executeMssql: vi.fn(), testMssqlConnection: vi.fn() }));

import { POST as params } from '@/app/api/execute/parameters/route';
import { resetRateLimits } from '@/lib/request-guard';
import { paramTypeFor } from '@/lib/execution/param-catalog';
import { createTestSession } from '../helpers/auth';

const connection = { host: 'db.example.com', database: 'app', username: 'svc_user', password: 'Sup3rSecret!' };
const post = (body: unknown, cookie?: string) =>
  new Request('http://localhost/api/execute/parameters', {
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

describe('paramTypeFor (UX-2)', () => {
  it('maps SQL Server types to the editor types and leaves the rest unsupported', () => {
    expect(paramTypeFor('smallint')).toBe('int');
    expect(paramTypeFor('MONEY')).toBe('decimal');
    expect(paramTypeFor('datetime2')).toBe('datetime');
    expect(paramTypeFor('xml')).toBeNull();
    expect(paramTypeFor('geography')).toBeNull();
  });
});

describe('POST /api/execute/parameters (UX-2)', () => {
  it('401 without a session', async () => {
    expect((await params(post({ engine: 'mssql', name: 'dbo.p', connection }))).status).toBe(401);
  });

  it('403 when live execution is off, before any connection', async () => {
    setLive(false);
    expect((await params(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie))).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('400 for a name that is not a plain identifier, without connecting', async () => {
    const res = await params(post({ engine: 'mssql', name: 'dbo.p; DROP TABLE x', connection }, cookie));
    expect(res.status).toBe(400);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('400 for postgres', async () => {
    expect((await params(post({ engine: 'postgres', name: 'dbo.p', connection }, cookie))).status).toBe(400);
  });

  it('returns each parameter with its editor type, and flags unsupported types', async () => {
    mock.list.mockResolvedValue([
      { name: '@StartDate', sqlType: 'datetime', isOutput: false, hasDefault: false },
      { name: '@ExecutionLogID', sqlType: 'int', isOutput: true, hasDefault: false },
      { name: '@Shape', sqlType: 'xml', isOutput: false, hasDefault: true },
    ]);
    const body = await (await params(post({ engine: 'mssql', name: 'dbo.usp_Get', connection }, cookie))).json();
    expect(body.parameters).toEqual([
      { name: '@StartDate', sqlType: 'datetime', type: 'datetime', supported: true, isOutput: false, hasDefault: false },
      { name: '@ExecutionLogID', sqlType: 'int', type: 'int', supported: true, isOutput: true, hasDefault: false },
      { name: '@Shape', sqlType: 'xml', type: null, supported: false, isOutput: false, hasDefault: true },
    ]);
  });

  it('404 when the procedure has no parameters or does not exist', async () => {
    mock.list.mockResolvedValue([]);
    expect((await params(post({ engine: 'mssql', name: 'dbo.nope', connection }, cookie))).status).toBe(404);
  });

  it('502 with a generic message when the connection fails, without echoing the driver error', async () => {
    mock.list.mockRejectedValue(Object.assign(new Error('Login failed for user svc_user at db.example.com'), { code: 'ELOGIN' }));
    const res = await params(post({ engine: 'mssql', name: 'dbo.p', connection }, cookie));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toMatch(/svc_user|db\.example\.com|Login failed/);
  });
});
