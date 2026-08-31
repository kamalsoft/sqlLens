/**
 * DataDog Log Analyzer (R007)
 * Parses DataDog log payloads and extracts SQL/DB errors for AI analysis.
 */

export interface DatadogLog {
  timestamp?: string;
  status?: string;
  service?: string;
  message?: string;
  attributes?: Record<string, any>;
  tags?: string[];
  host?: string;
  error?: {
    message?: string;
    stack?: string;
    kind?: string;
  };
}

export interface ParsedSqlError {
  errorType: string;
  errorCode?: string;
  message: string;
  query?: string;
  table?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: string;
  service?: string;
  host?: string;
}

export interface DatadogAnalysis {
  summary: string;
  totalLogs: number;
  errorCount: number;
  sqlErrors: ParsedSqlError[];
  patterns: string[];
  rootCauses: string[];
  recommendations: string[];
  verdict: string;
}

// ---------------------------------------------------------------------------
// SQL Error patterns
// ---------------------------------------------------------------------------

const SQL_ERROR_PATTERNS: { pattern: RegExp; type: string; severity: ParsedSqlError['severity'] }[] = [
  { pattern: /deadlock/i, type: 'Deadlock', severity: 'CRITICAL' },
  { pattern: /timeout|timed out/i, type: 'Query Timeout', severity: 'HIGH' },
  { pattern: /cannot open.*database|login failed/i, type: 'Connection Failure', severity: 'CRITICAL' },
  { pattern: /lock.*wait.*exceeded|blocking/i, type: 'Lock Contention', severity: 'HIGH' },
  { pattern: /out of memory|memory pressure/i, type: 'Memory Pressure', severity: 'HIGH' },
  { pattern: /disk.*full|no space left/i, type: 'Disk Full', severity: 'CRITICAL' },
  { pattern: /index.*missing|table scan/i, type: 'Missing Index', severity: 'MEDIUM' },
  { pattern: /conversion.*failed|arithmetic overflow/i, type: 'Data Type Error', severity: 'MEDIUM' },
  { pattern: /divide by zero/i, type: 'Division by Zero', severity: 'MEDIUM' },
  { pattern: /transaction.*log.*full/i, type: 'Transaction Log Full', severity: 'CRITICAL' },
  { pattern: /tempdb/i, type: 'TempDB Issue', severity: 'HIGH' },
  { pattern: /parameter sniff/i, type: 'Parameter Sniffing', severity: 'MEDIUM' },
  { pattern: /syntax error|invalid object name/i, type: 'SQL Syntax Error', severity: 'HIGH' },
  { pattern: /unique.*constraint|primary key.*violation|duplicate key/i, type: 'Constraint Violation', severity: 'MEDIUM' },
  { pattern: /foreign key.*constraint/i, type: 'Foreign Key Violation', severity: 'MEDIUM' },
  { pattern: /connection pool.*exhausted|max pool size/i, type: 'Connection Pool Exhausted', severity: 'CRITICAL' },
];

function extractQuery(message: string): string | undefined {
  const match = message.match(/(?:exec|execute|select|insert|update|delete|from)\s+[\w\s,=()@'"[\].]+/i);
  return match ? match[0].substring(0, 200) : undefined;
}

function extractTable(message: string): string | undefined {
  const match = message.match(/(?:table|object)\s+'?(\w+)'?/i) ||
    message.match(/FROM\s+(\w+)/i) ||
    message.match(/INTO\s+(\w+)/i);
  return match ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseDatadogLogs(logs: DatadogLog[]): DatadogAnalysis {
  const sqlErrors: ParsedSqlError[] = [];

  for (const log of logs) {
    const rawMessage = log.message || log.error?.message || JSON.stringify(log.attributes || {});

    for (const { pattern, type, severity } of SQL_ERROR_PATTERNS) {
      if (pattern.test(rawMessage)) {
        const isDuplicate = sqlErrors.some(e => e.errorType === type && e.message.substring(0, 50) === rawMessage.substring(0, 50));
        if (!isDuplicate) {
          sqlErrors.push({
            errorType: type,
            errorCode: log.attributes?.error?.code || log.attributes?.db?.error_code,
            message: rawMessage.substring(0, 500),
            query: extractQuery(rawMessage),
            table: extractTable(rawMessage),
            severity,
            timestamp: log.timestamp || new Date().toISOString(),
            service: log.service,
            host: log.host,
          });
        }
        break;
      }
    }
  }

  // Derive patterns
  const typeCounts = sqlErrors.reduce<Record<string, number>>((acc, e) => {
    acc[e.errorType] = (acc[e.errorType] || 0) + 1;
    return acc;
  }, {});

  const patterns = Object.entries(typeCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `${type}: ${count} occurrence(s)`);

  // Root causes
  const rootCauses: string[] = [];
  if (typeCounts['Deadlock']) rootCauses.push('Transactions are competing for the same resources in opposite order — review access patterns and add retry logic');
  if (typeCounts['Query Timeout']) rootCauses.push('Queries are exceeding the timeout threshold — likely missing indexes or long-running cursors');
  if (typeCounts['Lock Contention']) rootCauses.push('High concurrent write load is causing blocking chains — consider READ UNCOMMITTED or SNAPSHOT isolation');
  if (typeCounts['Connection Pool Exhausted']) rootCauses.push('Connection pool is depleted — application is not returning connections promptly or pool size is too small');
  if (typeCounts['Transaction Log Full']) rootCauses.push('Transaction log is not being truncated — check log backup frequency and recovery model');
  if (typeCounts['Missing Index']) rootCauses.push('Query optimizer cannot find efficient access paths — add missing indexes from sys.dm_db_missing_index_details');
  if (rootCauses.length === 0) rootCauses.push('No clear root cause pattern detected — logs may require deeper manual review');

  // Recommendations
  const recommendations: string[] = [
    ...rootCauses.map(rc => rc.split(' — ')[1]).filter(Boolean),
    'Enable Query Store on the target database to track plan regressions automatically',
    'Set up DataDog SQL Server Integration to collect wait stats and blocking chains proactively',
    'Review sys.dm_exec_query_stats for the top 10 resource-consuming queries',
    'Configure alerts in DataDog for error rates exceeding baseline thresholds',
  ];

  const criticalCount = sqlErrors.filter(e => e.severity === 'CRITICAL').length;
  const verdict = criticalCount > 0
    ? `❌ CRITICAL — ${criticalCount} critical error type(s) detected. Immediate intervention required.`
    : sqlErrors.length > 0
    ? `⚠️ WARNING — ${sqlErrors.length} SQL error type(s) found. Investigate before next release.`
    : '✅ CLEAN — No SQL-related errors detected in these logs.';

  return {
    summary: `Analyzed ${logs.length} DataDog log entries. Found ${sqlErrors.length} distinct SQL error pattern(s) across ${logs.length} entries.`,
    totalLogs: logs.length,
    errorCount: sqlErrors.length,
    sqlErrors,
    patterns,
    rootCauses,
    recommendations,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Parse raw text logs (pasted by user)
// ---------------------------------------------------------------------------

export function parseRawLogText(raw: string): DatadogLog[] {
  const lines = raw.split('\n').filter(l => l.trim());
  return lines.map(line => {
    try {
      return JSON.parse(line) as DatadogLog;
    } catch {
      return { message: line, timestamp: new Date().toISOString() };
    }
  });
}
