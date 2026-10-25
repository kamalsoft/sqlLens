import { NextResponse } from 'next/server';
import { insertAudit } from '@/db/audit-repo';
import { requireSession } from '@/lib/auth';
import { readAppConfig } from '@/lib/app-config';
import { executeSP, type ExecutionResult } from '@/lib/sp-executor';
import { analyzeExecution, compareExecutions } from '@/lib/audit-analyzer';
import { parseExecuteRequest } from '@/lib/execution/request';
import { ExecAbortError, ExecTimeoutError, type ExecTarget } from '@/lib/execution/types';
import { rateLimit } from '@/lib/request-guard';
import { logError } from '@/lib/redact';
import { badRequest, readJson } from '@/lib/validation/body';

/** Audit copy of a target: parameter values and connection credentials are never stored (C10). */
function auditTarget(t: ExecTarget | undefined) {
  if (!t) return undefined;
  return t.kind === 'batch'
    ? { kind: t.kind, sql: t.sql }
    : { kind: t.kind, name: t.name, params: t.params.map((p) => ({ name: p.name, type: p.type })) };
}

const sumReads = (r: ExecutionResult): number | null =>
  r.stats.io.length ? r.stats.io.reduce((a, row) => a + row.logicalReads, 0) : null;

export async function POST(request: Request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  if (!rateLimit(`execute:${session.sessionId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many execution requests. Try again in a minute.' }, { status: 429 });
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;

  try {
    const cfg = await readAppConfig();
    const parsed = parseExecuteRequest(body.body, cfg.maxSqlLength);
    if (!parsed.ok) return badRequest(parsed.error, parsed.field);
    const req = parsed.value;

    if (req.engine !== 'simulation' && !cfg.allowLiveExecution) {
      return NextResponse.json({ error: 'Live execution is disabled' }, { status: 403 });
    }

    const opts = { timeoutMs: cfg.queryTimeoutMs, signal: request.signal, logSqlText: cfg.logSqlText };
    const originalResult = await executeSP(req.original, 'Original_SP', req.engine, req.connection, opts);

    let result: Record<string, unknown>;
    let auditType: 'EXECUTE' | 'EXECUTE_COMPARE' = 'EXECUTE';
    let allOk = originalResult.success;
    let warnings = originalResult.warnings ?? [];

    if (req.mode === 'compare' && req.optimized) {
      const optimizedResult = await executeSP(req.optimized, 'Optimized_SP', req.engine, req.connection, opts);
      allOk = allOk && optimizedResult.success;
      warnings = [...new Set([...warnings, ...(optimizedResult.warnings ?? [])])];
      const { original, optimized, comparison } = compareExecutions(originalResult, optimizedResult);
      result = {
        mode: 'compare',
        simulated: req.engine === 'simulation',
        warnings,
        original: { execution: originalResult, analysis: original },
        optimized: { execution: optimizedResult, analysis: optimized },
        comparison,
      };
      auditType = 'EXECUTE_COMPARE';
    } else {
      result = {
        mode: 'single',
        simulated: req.engine === 'simulation',
        warnings,
        execution: originalResult,
        analysis: analyzeExecution(originalResult),
      };
    }

    // C10: engine, host and database only. No username, password or parameter values.
    const saved = insertAudit({
      sessionId: session.sessionId,
      type: auditType,
      request: {
        mode: req.mode,
        engine: req.engine,
        ...(req.connection ? { host: req.connection.host, database: req.connection.database } : {}),
        original: auditTarget(req.original),
        optimized: auditTarget(req.optimized),
      },
      response: result,
      engine: req.engine,
      simulated: req.engine === 'simulation',
      status: allOk ? 'ok' : 'error',
      elapsedMs: originalResult.stats.totalElapsedMs,
      logicalReads: sumReads(originalResult),
    });

    return NextResponse.json({ id: saved.id, recordNumber: saved.recordNumber, result });
  } catch (error) {
    if (error instanceof ExecTimeoutError) {
      return NextResponse.json({ error: 'Query timed out' }, { status: 504 });
    }
    if (error instanceof ExecAbortError) {
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 });
    }
    logError('[execute/route]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
