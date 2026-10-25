import type { ExecutionStats, StatisticsIORow } from './types';

const num = (s: string): number => parseInt(s.replace(/,/g, ''), 10);
const NUM = '([\\d,]+)';

/** Parse SET STATISTICS IO/TIME text. Pure; unknown values are null. */
export function parseMssqlStatistics(text: string): ExecutionStats {
  const raw = text ?? '';
  const byTable = new Map<string, StatisticsIORow>();

  const ioRe = /Table '([^']+)'\.\s*(Scan count[^\n]*)/gi;
  const field = (line: string, label: string): number | null => {
    const f = line.match(new RegExp(`(?:^|[\\s,])${label}\\s+(\\d[\\d,]*\\d|\\d)(?=[,.\\s]|$)`, 'i'));
    return f ? num(f[1]) : null;
  };
  let m: RegExpExecArray | null;
  while ((m = ioRe.exec(raw)) !== null) {
    const line = m[2];
    const add = {
      scanCount: field(line, 'scan count') ?? 0,
      logicalReads: field(line, 'logical reads') ?? 0,
      physicalReads: field(line, 'physical reads') ?? 0,
      readAheadReads: field(line, 'read-ahead reads') ?? 0,
      lobLogicalReads: field(line, 'lob logical reads') ?? 0,
      lobPhysicalReads: field(line, 'lob physical reads') ?? 0,
      lobReadAheadReads: field(line, 'lob read-ahead reads') ?? 0,
    };
    const cur = byTable.get(m[1]);
    if (cur) {
      cur.scanCount += add.scanCount;
      cur.logicalReads += add.logicalReads;
      cur.physicalReads += add.physicalReads;
      cur.readAheadReads += add.readAheadReads;
      cur.lobLogicalReads += add.lobLogicalReads;
      cur.lobPhysicalReads += add.lobPhysicalReads;
      cur.lobReadAheadReads += add.lobReadAheadReads;
    } else {
      byTable.set(m[1], { table: m[1], ...add });
    }
  }

  const timeRe = new RegExp(
    `(SQL Server parse and compile time|SQL Server Execution Times):\\s*CPU time = ${NUM} ms,\\s*elapsed time = ${NUM} ms`,
    'gi',
  );
  let pCpu: number | null = null, pEl: number | null = null;
  let eCpu: number | null = null, eEl: number | null = null;
  while ((m = timeRe.exec(raw)) !== null) {
    const cpu = num(m[2]);
    const el = num(m[3]);
    if (/parse/i.test(m[1])) {
      pCpu = (pCpu ?? 0) + cpu;
      pEl = (pEl ?? 0) + el;
    } else {
      eCpu = (eCpu ?? 0) + cpu;
      eEl = (eEl ?? 0) + el;
    }
  }

  const total = pEl === null && eEl === null ? null : (pEl ?? 0) + (eEl ?? 0);
  return {
    parseAndCompileTime: pEl,
    parseAndCompileCpu: pCpu,
    executionTime: eEl,
    executionCpu: eCpu,
    totalElapsedMs: total,
    io: [...byTable.values()],
    messages: [],
    rawOutput: raw,
    plan: null,
    simulated: false,
  };
}
