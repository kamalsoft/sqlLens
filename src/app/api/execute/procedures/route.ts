import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readAppConfig } from '@/lib/app-config';
import { parseConnection } from '@/lib/execution/request';
import { listProcedures } from '@/lib/execution/mssql';
import { ExecTimeoutError } from '@/lib/execution/types';
import { rateLimit } from '@/lib/request-guard';
import { logError } from '@/lib/redact';
import { badRequest, readJson } from '@/lib/validation/body';

const CATALOG_TIMEOUT_MS = 10_000;

/**
 * The stored procedures in the chosen database, for the Execute screen's procedure picker.
 * Read-only. It connects to the server, so it has the same gates as parameter discovery: a session,
 * a rate limit and live execution.
 */
export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`procedures:${auth.session.sessionId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many procedure list requests. Try again in a minute.' }, { status: 429 });
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;

  if (body.body.engine !== 'mssql') return badRequest('Listing procedures is available for mssql only', 'engine');
  const conn = parseConnection(body.body.connection, 'connection', { engine: 'mssql' });
  if (!conn.ok) return badRequest(conn.error, conn.field);

  try {
    const cfg = await readAppConfig();
    if (!cfg.allowLiveExecution) {
      return NextResponse.json({ error: 'Live execution is disabled' }, { status: 403 });
    }
    return NextResponse.json({ procedures: await listProcedures(conn.value, CATALOG_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof ExecTimeoutError) {
      return NextResponse.json({ error: 'Procedure list timed out' }, { status: 504 });
    }
    // Driver errors can echo the host, domain or user name; log redacted, answer generically.
    logError('[execute/procedures]', { name: (error as Error)?.name, code: (error as { code?: unknown })?.code });
    const login = (error as { code?: unknown })?.code === 'ELOGIN';
    return NextResponse.json({ error: login ? 'Login failed. Check the authentication type, user name and password.' : 'Could not list the stored procedures' }, { status: 502 });
  }
}
