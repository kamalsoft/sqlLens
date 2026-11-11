import { NextResponse } from 'next/server';
import { insertAudit } from '@/db/audit-repo';
import { requireSession } from '@/lib/auth';
import { readAppConfig } from '@/lib/app-config';
import { executeSP, type ExecutionResult } from '@/lib/sp-executor';
import { analyzeExecution, compareExecutions, summarizeRuns, type RunSample } from '@/lib/audit-analyzer';
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

    // P8-03: repeated runs, single mode only. The first run is a warm-up and is dropped from the summary.
    const runs = body.body.runs ?? 1;
    if (typeof runs !== 'number' || !Number.isInteger(runs) || runs < 1 || runs > cfg.maxRuns) {
      return badRequest(`runs must be an integer from 1 to ${cfg.maxRuns}`, 'runs');
    }
    if (runs > 1 && req.mode !== 'single') return badRequest('Repeated runs apply to single mode only', 'runs');
    const WARMUP_RUNS = 1;
    const total = runs > 1 ? WARMUP_RUNS + runs : 1;

    const opts = { timeoutMs: cfg.queryTimeoutMs, signal: request.signal, logSqlText: cfg.logSqlText };
    const results: ExecutionResult[] = [];
    const samples: RunSample[] = [];
    for (let i = 0; i < total; i++) {
      const run = await executeSP(req.original, 'Original_SP', req.engine, req.connection, { ...opts, audit: i === total - 1 });
      results.push(run);
      samples.push({ elapsedMs: run.stats.totalElapsedMs, logicalReads: sumReads(run) });
      if (!run.success) break;
    }
    const originalResult = results[results.length - 1];
    const repeatedOk = results.length === total && originalResult.success;
    const runSummary = runs > 1 && repeatedOk ? summarizeRuns(samples, WARMUP_RUNS) : null;

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
        analysis: analyzeExecution(originalResult, { maxLogicalReads: cfg.maxLogicalReads, maxElapsedMs: cfg.maxElapsedMs, maxScanCount: cfg.maxScanCount }, runSummary),
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
