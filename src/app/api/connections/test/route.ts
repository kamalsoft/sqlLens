import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readAppConfig } from '@/lib/app-config';
import { parseConnection } from '@/lib/execution/request';
import { testMssqlConnection } from '@/lib/execution/mssql';
import { testPostgresConnection } from '@/lib/execution/postgres';
import { ExecTimeoutError } from '@/lib/execution/types';
import { rateLimit } from '@/lib/request-guard';
import { logError } from '@/lib/redact';
import { badRequest, readJson } from '@/lib/validation/body';

const TEST_TIMEOUT_MS = 5_000;

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`conntest:${auth.session.sessionId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many connection tests. Try again in a minute.' }, { status: 429 });
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const engine = body.body.engine;
  if (engine !== 'mssql' && engine !== 'postgres') return badRequest('engine must be mssql or postgres', 'engine');
  const conn = parseConnection(body.body.connection);
  if (!conn.ok) return badRequest(conn.error, conn.field);

  try {
    const cfg = await readAppConfig();
    if (!cfg.allowLiveExecution) {
      return NextResponse.json({ error: 'Live execution is disabled' }, { status: 403 });
    }
    const out = engine === 'mssql'
      ? await testMssqlConnection(conn.value, TEST_TIMEOUT_MS)
      : await testPostgresConnection(conn.value, TEST_TIMEOUT_MS);
    return NextResponse.json({
      ok: true, engine, serverVersion: out.serverVersion, encrypted: out.encrypted,
      ...(out.warnings.length ? { warnings: out.warnings } : {}),
    });
  } catch (error) {
    if (error instanceof ExecTimeoutError) {
      return NextResponse.json({ ok: false, engine, error: 'Connection test timed out' }, { status: 504 });
    }
    // Driver errors can echo the host or user name; log redacted, answer generically.
    logError('[connections/test]', { name: (error as Error)?.name, code: (error as { code?: unknown })?.code });
    return NextResponse.json({ ok: false, engine, error: 'Connection failed' }, { status: 502 });
  }
}
