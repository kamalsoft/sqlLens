/**
 * SP Execution Engine (R003)
 *
 * Architecture:
 *  - Supports SQL Server (mssql), PostgreSQL (pg), and a SIMULATION mode
 *    that generates realistic statistical output without a real connection.
 *  - executeSP is a dispatcher: real engines live in execution/{mssql,postgres}.ts
 *    (D-005), the labeled simulator stays here (D-004).
 *
 * Text-file storage:
 *  - Every run is written to audit_logs/<record-number>_<type>_<timestamp>.txt
 *  - The record number is stored in the SQLite DB so R004 can look it up.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { executeMssql } from './execution/mssql';
import { executePostgres } from './execution/postgres';
import { ExecAbortError, ExecTimeoutError } from './execution/types';
import type { EngineName, ExecConnection, ExecOptions, ExecTarget } from './execution/types';
import type { ExecutionStats, StatisticsIORow } from './telemetry/types';

export type { ExecutionStats, StatisticsIORow };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  recordNumber: string;
  spLabel: string;
  connectionEngine: string;
  executedAt: string;
  stats: ExecutionStats;
  textFilePath: string;
  /** TLS or policy warnings (P6-08). */
  warnings?: string[];
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Audit log directory (relative to project root)
// ---------------------------------------------------------------------------

function auditLogDir(): string {
  const dir = path.resolve(process.env.SQLLENS_AUDIT_LOG_DIR || path.join(process.cwd(), 'audit_logs'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nextRecordNumber(): string {
  const existing = fs.readdirSync(auditLogDir()).filter(f => f.endsWith('.txt'));
  const nums = existing.map(f => parseInt(f.split('_')[0], 10)).filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return String(next).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Text file writer
// ---------------------------------------------------------------------------

const fmt = (v: number | null): string => (v === null ? 'n/a' : `${v}ms`);

/** Remove any connection detail that a driver error message may echo back. */
function scrubConnection(message: string, config: Partial<ExecConnection>): string {
  let out = String(message);
  for (const v of [config.password, config.username, config.host, config.database]) {
    if (v && v.length >= 3) out = out.split(v).join('[redacted]');
  }
  return out;
}

function writeAuditLog(
  recordNumber: string,
  spLabel: string,
  sp: string,
  stats: ExecutionStats,
  engine: string,
  logSqlText: boolean,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${recordNumber}_${spLabel.replace(/\s+/g, '_')}_${timestamp}.txt`;
  const filePath = path.join(auditLogDir(), filename);

  const content = [
    '='.repeat(80),
    `SQLLENS EXECUTION AUDIT LOG`,
    `Record Number : ${recordNumber}`,
    `SP Label      : ${spLabel}`,
    `Engine        : ${engine}`,
    `Simulated     : ${stats.simulated}`,
    `Executed At   : ${new Date().toISOString()}`,
    '='.repeat(80),
    '',
    logSqlText ? '--- STORED PROCEDURE ---' : '--- STORED PROCEDURE (text omitted: logSqlText=false) ---',
    logSqlText ? sp : `sha256=${createHash('sha256').update(sp).digest('hex')} length=${sp.length}`,
    '',
    '--- STATISTICS TIME ---',
    ` SQL Server parse and compile time: ${fmt(stats.parseAndCompileTime)} (CPU: ${fmt(stats.parseAndCompileCpu)})`,
    ` SQL Server execution time        : ${fmt(stats.executionTime)} (CPU: ${fmt(stats.executionCpu)})`,
    ` Total elapsed time               : ${fmt(stats.totalElapsedMs)}`,
    '',
    '--- STATISTICS IO ---',
    stats.io.map(row =>
      `Table '${row.table}'. Scan count ${row.scanCount}, logical reads ${row.logicalReads}, ` +
      `physical reads ${row.physicalReads}, read-ahead reads ${row.readAheadReads}, ` +
      `lob logical reads ${row.lobLogicalReads}, lob physical reads ${row.lobPhysicalReads}, ` +
      `lob read-ahead reads ${row.lobReadAheadReads}.`
    ).join('\n'),
    '',
    '--- MESSAGES ---',
    stats.messages.join('\n'),
    '',
    '--- RAW OUTPUT ---',
    stats.rawOutput,
    '',
    '='.repeat(80),
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Simulation engine
// ---------------------------------------------------------------------------

function simulateExecution(sp: string, spLabel: string): ExecutionStats {
  const hasCursor = /CURSOR/i.test(sp);
  const hasSelect = /SELECT\s+\*/i.test(sp);
  const hasNolock = /WITH\s*\(NOLOCK\)/i.test(sp);
  const hasJoins = (sp.match(/JOIN/gi) || []).length;
  const lineCount = sp.split('\n').length;

  // Simulate realistic SQL Server statistics
  const baseLogicalReads = hasSelect ? 1200 : 420;
  const cursorPenalty = hasCursor ? 8000 : 0;
  const joinCost = hasJoins * 340;
  const lockBonus = hasNolock ? 0.6 : 1.0;

  const logicalReads = Math.floor((baseLogicalReads + cursorPenalty + joinCost) * lockBonus + Math.random() * 50);
  const physicalReads = Math.floor(logicalReads * 0.08 * Math.random());
  const readAhead = Math.floor(physicalReads * 0.3);

  const parseTime = Math.floor(lineCount * 0.4 + Math.random() * 5);
  const execTime = Math.floor(logicalReads * 0.05 + (hasCursor ? 250 : 0) + Math.random() * 20);
  const totalMs = parseTime + execTime + Math.floor(Math.random() * 10);

  const tables: string[] = [];
  const tableMatches = sp.match(/FROM\s+(\w+)|JOIN\s+(\w+)/gi) || [];
  tableMatches.forEach(m => {
    const t = m.replace(/FROM\s+|JOIN\s+/i, '').trim();
    if (t) tables.push(t);
  });
  if (tables.length === 0) tables.push('dbo.MainTable');

  const io: StatisticsIORow[] = [...new Set(tables)].map(table => ({
    table,
    scanCount: hasCursor ? Math.floor(Math.random() * 50) + 10 : 1,
    logicalReads: Math.floor(logicalReads / tables.length),
    physicalReads: Math.floor(physicalReads / tables.length),
    readAheadReads: readAhead,
    lobLogicalReads: 0,
    lobPhysicalReads: 0,
    lobReadAheadReads: 0,
  }));

  const messages = [
    `(${Math.floor(Math.random() * 5000) + 100} rows affected)`,
    hasCursor ? `[WARN] CURSOR detected — ${io[0]?.scanCount || 0} scan iterations executed` : '',
    hasSelect ? '[WARN] SELECT * — all columns fetched' : '',
  ].filter(Boolean);

  const rawOutput = [
    `SET STATISTICS TIME ON`,
    `SET STATISTICS IO ON`,
    ``,
    `EXEC ${spLabel}`,
    ``,
    `SQL Server parse and compile time:`,
    `   CPU time = ${parseTime} ms, elapsed time = ${parseTime} ms.`,
    ``,
    ...io.map(row =>
      `Table '${row.table}'. Scan count ${row.scanCount}, logical reads ${row.logicalReads}, ` +
      `physical reads ${row.physicalReads}, read-ahead reads ${row.readAheadReads}.`
    ),
    ``,
    ` SQL Server Execution Times:`,
    `   CPU time = ${execTime} ms,  elapsed time = ${totalMs} ms.`,
    ``,
    ...messages,
  ].join('\n');

  return {
    parseAndCompileTime: parseTime,
    parseAndCompileCpu: parseTime,
    executionTime: execTime,
    executionCpu: Math.floor(execTime * 0.85),
    totalElapsedMs: totalMs,
    io,
    messages,
    rawOutput,
    plan: null,
    simulated: true,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Text used for the simulator and the text log. Parameter values are never included. */
export function targetText(target: ExecTarget): string {
  return target.kind === 'batch'
    ? target.sql
    : `EXEC ${target.name}${target.params.length ? ' ' + target.params.map((p) => p.name.replace(/^@?/, '@')).join(', ') : ''}`;
}

export interface ExecuteOptions extends ExecOptions {
  logSqlText: boolean;
}

/**
 * Dispatch one target to the simulator or a real engine. Timeouts and aborts are rethrown
 * (after the text log is written) so the route can answer 504 / abort; other failures are
 * returned as `success: false` with connection details scrubbed.
 */
export async function executeSP(
  target: ExecTarget,
  spLabel: string,
  engine: EngineName,
  connection: ExecConnection | undefined,
  opts: ExecuteOptions,
): Promise<ExecutionResult> {
  const recordNumber = nextRecordNumber();
  const executedAt = new Date().toISOString();
  const text = targetText(target);

  const failed = (message: string, warnings: string[] = []) => {
    const failStats: ExecutionStats = {
      parseAndCompileTime: null, parseAndCompileCpu: null,
      executionTime: null, executionCpu: null, totalElapsedMs: null,
      io: [], messages: [message], rawOutput: message,
      plan: null, simulated: engine === 'simulation',
    };
    const textFilePath = writeAuditLog(recordNumber, spLabel, text, failStats, engine, opts.logSqlText);
    return { failStats, textFilePath, warnings };
  };

  try {
    let stats: ExecutionStats;
    let warnings: string[] = [];

    if (engine === 'mssql' || engine === 'postgres') {
      if (!connection) throw new Error('connection is required');
      const out = engine === 'mssql'
        ? await executeMssql(connection, target, opts)
        : await executePostgres(connection, target, opts);
      stats = out.stats;
      warnings = out.warnings;
    } else {
      stats = simulateExecution(text, spLabel);
    }

    const textFilePath = writeAuditLog(recordNumber, spLabel, text, stats, engine, opts.logSqlText);
    return { recordNumber, spLabel, connectionEngine: engine, executedAt, stats, textFilePath, warnings, success: true };
  } catch (err) {
    if (err instanceof ExecTimeoutError || err instanceof ExecAbortError) {
      failed(err.message);
      throw err;
    }
    const safeMessage = scrubConnection(err instanceof Error ? err.message : 'Execution failed', connection ?? {});
    const { failStats, textFilePath } = failed(safeMessage);
    return { recordNumber, spLabel, connectionEngine: engine, executedAt, stats: failStats, textFilePath, success: false, error: safeMessage };
  }
}
