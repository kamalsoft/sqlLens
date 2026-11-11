import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { readAppConfig } from '@/lib/app-config';
import { parseConnection } from '@/lib/execution/request';
import { listProcedureParams } from '@/lib/execution/mssql';
import { PROCEDURE_NAME_RE, paramTypeFor } from '@/lib/execution/param-catalog';
import { ExecTimeoutError } from '@/lib/execution/types';
import { rateLimit } from '@/lib/request-guard';
import { logError } from '@/lib/redact';
import { badRequest, readJson } from '@/lib/validation/body';

const CATALOG_TIMEOUT_MS = 5_000;

/**
 * UX-2: the parameters of a stored procedure, from the catalog, with the editor type for each.
 * Read-only. It connects to the database, so it needs a session and live execution, like a run.
 */
export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;

  if (!rateLimit(`params:${auth.session.sessionId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many parameter requests. Try again in a minute.' }, { status: 429 });
  }
  const body = await readJson(request);
  if (!body.ok) return body.response;

  if (body.body.engine !== 'mssql') return badRequest('Parameter discovery is available for mssql only', 'engine');
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
    const rows = await listProcedureParams(conn.value, name.trim(), CATALOG_TIMEOUT_MS);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No stored procedure with that name, or it has no parameters' }, { status: 404 });
    }
    return NextResponse.json({
      parameters: rows.map((p) => {
        const type = paramTypeFor(p.sqlType);
        return { name: p.name, sqlType: p.sqlType, type, supported: type !== null, isOutput: p.isOutput, hasDefault: p.hasDefault };
      }),
    });
  } catch (error) {
    if (error instanceof ExecTimeoutError) {
      return NextResponse.json({ error: 'Parameter lookup timed out' }, { status: 504 });
    }
    // Driver errors can echo the host or user name; log redacted, answer generically.
    logError('[execute/parameters]', { name: (error as Error)?.name, code: (error as { code?: unknown })?.code });
    return NextResponse.json({ error: 'Could not read the parameters' }, { status: 502 });
  }
}
