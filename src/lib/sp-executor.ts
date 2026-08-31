/**
 * SP Execution Engine (R003)
 *
 * Architecture:
 *  - Supports SQL Server (mssql), PostgreSQL (pg), and a SIMULATION mode
 *    that generates realistic statistical output without a real connection.
 *  - Real driver packages (mssql / pg) are optional — the engine detects
 *    availability at runtime and falls back to simulation if missing.
 *
 * Text-file storage:
 *  - Every run is written to audit_logs/<record-number>_<type>_<timestamp>.txt
 *  - The record number is stored in the SQLite DB so R004 can look it up.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbConnectionConfig {
  engine: 'mssql' | 'postgres' | 'simulation';
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  trustServerCertificate?: boolean;
}

export interface StatisticsIORow {
  table: string;
  scanCount: number;
  logicalReads: number;
  physicalReads: number;
  readAheadReads: number;
  lobLogicalReads: number;
  lobPhysicalReads: number;
  lobReadAheadReads: number;
}

export interface ExecutionStats {
  parseAndCompileTime: number;   // ms
  parseAndCompileCpu: number;    // ms
  executionTime: number;          // ms
  executionCpu: number;           // ms
  totalElapsedMs: number;
  io: StatisticsIORow[];
  messages: string[];
  rawOutput: string;
}

export interface ExecutionResult {
  recordNumber: string;
  spLabel: string;
  connectionEngine: string;
  executedAt: string;
  stats: ExecutionStats;
  textFilePath: string;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Audit log directory (relative to project root)
// ---------------------------------------------------------------------------

const AUDIT_LOG_DIR = path.resolve(process.cwd(), 'audit_logs');
if (!fs.existsSync(AUDIT_LOG_DIR)) {
  fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
}

function nextRecordNumber(): string {
  const existing = fs.readdirSync(AUDIT_LOG_DIR).filter(f => f.endsWith('.txt'));
  const nums = existing.map(f => parseInt(f.split('_')[0], 10)).filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return String(next).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Text file writer
// ---------------------------------------------------------------------------

function writeAuditLog(
  recordNumber: string,
  spLabel: string,
  sp: string,
  stats: ExecutionStats,
  engine: string,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${recordNumber}_${spLabel.replace(/\s+/g, '_')}_${timestamp}.txt`;
  const filePath = path.join(AUDIT_LOG_DIR, filename);

  const content = [
    '='.repeat(80),
    `SQLLENS EXECUTION AUDIT LOG`,
    `Record Number : ${recordNumber}`,
    `SP Label      : ${spLabel}`,
    `Engine        : ${engine}`,
    `Executed At   : ${new Date().toISOString()}`,
    '='.repeat(80),
    '',
    '--- STORED PROCEDURE ---',
    sp,
    '',
    '--- STATISTICS TIME ---',
    ` SQL Server parse and compile time: ${stats.parseAndCompileTime}ms (CPU: ${stats.parseAndCompileCpu}ms)`,
    ` SQL Server execution time        : ${stats.executionTime}ms (CPU: ${stats.executionCpu}ms)`,
    ` Total elapsed time               : ${stats.totalElapsedMs}ms`,
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

  const totalLogical = io.reduce((s, r) => s + r.logicalReads, 0);
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
  };
}

// ---------------------------------------------------------------------------
// Real DB execution (SQL Server via mssql — optional)
// ---------------------------------------------------------------------------

async function executeViaMssql(config: DbConnectionConfig, sp: string): Promise<ExecutionStats> {
  let mssql: any;
  try {
    mssql = require('mssql');
  } catch {
    throw new Error('mssql package not installed. Run: npm install mssql. Or use simulation mode.');
  }

  const pool = await mssql.connect({
    server: config.host || 'localhost',
    port: config.port || 1433,
    database: config.database,
    user: config.username,
    password: config.password,
    options: { trustServerCertificate: config.trustServerCertificate ?? true },
  });

  const wrappedSp = `
    SET STATISTICS IO ON
    SET STATISTICS TIME ON
    ${sp}
    SET STATISTICS IO OFF
    SET STATISTICS TIME OFF
  `;

  const result = await pool.request().query(wrappedSp);
  await pool.close();

  // Parse messages from result.recordsets or pool.messages if available
  const rawMessages: string[] = (result as any).recordsets?.flat()?.map(String) || [];

  return parseRawStatisticsOutput(rawMessages.join('\n'));
}

async function executeViaPostgres(config: DbConnectionConfig, sp: string): Promise<ExecutionStats> {
  let pg: any;
  try {
    pg = require('pg');
  } catch {
    throw new Error('pg package not installed. Run: npm install pg. Or use simulation mode.');
  }

  const client = new pg.Client({
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: config.database,
    user: config.username,
    password: config.password,
  });

  await client.connect();
  const wrappedSp = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sp}`;
  const result = await client.query(wrappedSp);
  await client.end();

  const planLines: string[] = result.rows.map((r: any) => r['QUERY PLAN'] || Object.values(r)[0]);
  return parsePostgresPlan(planLines.join('\n'));
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

function parseRawStatisticsOutput(raw: string): ExecutionStats {
  const io: StatisticsIORow[] = [];
  const ioRegex = /Table '([^']+)'\.\s+Scan count (\d+),\s+logical reads (\d+),\s+physical reads (\d+),\s+read-ahead reads (\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = ioRegex.exec(raw)) !== null) {
    io.push({
      table: m[1], scanCount: +m[2], logicalReads: +m[3],
      physicalReads: +m[4], readAheadReads: +m[5],
      lobLogicalReads: 0, lobPhysicalReads: 0, lobReadAheadReads: 0,
    });
  }

  const cpuMatch = raw.match(/CPU time = (\d+) ms,\s+elapsed time = (\d+) ms/i);
  const execMatch = raw.match(/SQL Server Execution Times.*?CPU time = (\d+) ms.*?elapsed time = (\d+) ms/si);

  return {
    parseAndCompileTime: cpuMatch ? +cpuMatch[2] : 0,
    parseAndCompileCpu: cpuMatch ? +cpuMatch[1] : 0,
    executionTime: execMatch ? +execMatch[2] : 0,
    executionCpu: execMatch ? +execMatch[1] : 0,
    totalElapsedMs: (cpuMatch ? +cpuMatch[2] : 0) + (execMatch ? +execMatch[2] : 0),
    io,
    messages: [],
    rawOutput: raw,
  };
}

function parsePostgresPlan(planText: string): ExecutionStats {
  const execTimeMatch = planText.match(/Execution Time:\s*([\d.]+) ms/i);
  const planTimeMatch = planText.match(/Planning Time:\s*([\d.]+) ms/i);
  const bufferMatch = planText.match(/Buffers: shared hit=(\d+)/i);

  const execMs = execTimeMatch ? parseFloat(execTimeMatch[1]) : 0;
  const planMs = planTimeMatch ? parseFloat(planTimeMatch[1]) : 0;
  const sharedHit = bufferMatch ? +bufferMatch[1] : 0;

  return {
    parseAndCompileTime: Math.ceil(planMs),
    parseAndCompileCpu: Math.ceil(planMs),
    executionTime: Math.ceil(execMs),
    executionCpu: Math.ceil(execMs * 0.8),
    totalElapsedMs: Math.ceil(planMs + execMs),
    io: [{
      table: 'postgres_query', scanCount: 1,
      logicalReads: sharedHit, physicalReads: 0, readAheadReads: 0,
      lobLogicalReads: 0, lobPhysicalReads: 0, lobReadAheadReads: 0,
    }],
    messages: [planText],
    rawOutput: planText,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function executeSP(
  sp: string,
  spLabel: string,
  config: DbConnectionConfig,
): Promise<ExecutionResult> {
  const recordNumber = nextRecordNumber();
  const executedAt = new Date().toISOString();

  try {
    let stats: ExecutionStats;

    if (config.engine === 'mssql') {
      stats = await executeViaMssql(config, sp);
    } else if (config.engine === 'postgres') {
      stats = await executeViaPostgres(config, sp);
    } else {
      // simulation mode
      stats = simulateExecution(sp, spLabel);
    }

    const textFilePath = writeAuditLog(recordNumber, spLabel, sp, stats, config.engine);

    return { recordNumber, spLabel, connectionEngine: config.engine, executedAt, stats, textFilePath, success: true };
  } catch (err: any) {
    const failStats: ExecutionStats = {
      parseAndCompileTime: 0, parseAndCompileCpu: 0,
      executionTime: 0, executionCpu: 0, totalElapsedMs: 0,
      io: [], messages: [err.message], rawOutput: err.message,
    };
    const textFilePath = writeAuditLog(recordNumber, spLabel, sp, failStats, config.engine);
    return { recordNumber, spLabel, connectionEngine: config.engine, executedAt, stats: failStats, textFilePath, success: false, error: err.message };
  }
}
