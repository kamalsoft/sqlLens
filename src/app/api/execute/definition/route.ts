import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readAppConfig } from '@/lib/app-config';
import { parseConnection } from '@/lib/execution/request';
import { getProcedureDefinition } from '@/lib/execution/mssql';
import { PROCEDURE_NAME_RE } from '@/lib/execution/param-catalog';
import { ExecTimeoutError } from '@/lib/execution/types';
import { rateLimit } from '@/lib/request-guard';
import { logError } from '@/lib/redact';
import { badRequest, readJson } from '@/lib/validation/body';

const CATALOG_TIMEOUT_MS = 5_000;

/**
 * RF-5: the T-SQL text of a stored procedure, so the Execute page can refactor a procedure it ran
 * by name. Read-only. It connects to the database, so it has the same gates as parameter discovery:
 * a session, a rate limit and live execution.
 */
export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`definition:${auth.session.sessionId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many definition requests. Try again in a minute.' }, { status: 429 });
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;

  if (body.body.engine !== 'mssql') return badRequest('Reading a procedure definition is available for mssql only', 'engine');
  const name = body.body.name;
  if (typeof name !== 'string' || !PROCEDURE_NAME_RE.test(name.trim())) {
    return badRequest('Procedure name must look like dbo.MyProcedure', 'name');
  }
  const conn = parseConnection(body.body.connection);
  if (!conn.ok) return badRequest(conn.error, conn.field);

  try {
    const cfg = await readAppConfig();
    if (!cfg.allowLiveExecution) {
      return NextResponse.json({ error: 'Live execution is disabled' }, { status: 403 });
    }
    const definition = await getProcedureDefinition(conn.value, name.trim(), CATALOG_TIMEOUT_MS);
    if (definition === null) {
      return NextResponse.json(
        { error: 'No readable definition: the procedure does not exist, is encrypted, or this login lacks VIEW DEFINITION' },
        { status: 404 },
      );
    }
    return NextResponse.json({ definition });
  } catch (error) {
    if (error instanceof ExecTimeoutError) {
      return NextResponse.json({ error: 'Definition lookup timed out' }, { status: 504 });
    }
    // Driver errors can echo the host or user name; log redacted, answer generically.
    logError('[execute/definition]', { name: (error as Error)?.name, code: (error as { code?: unknown })?.code });
    return NextResponse.json({ error: 'Could not read the procedure definition' }, { status: 502 });
  }
}
