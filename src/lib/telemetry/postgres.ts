import type { ExecutionStats } from './types';

interface Acc { hit: number; read: number; sawBuffers: boolean }

function rootBuffers(plan: Record<string, unknown>, acc: Acc): void {
  const hit = plan['Shared Hit Blocks'];
  const read = plan['Shared Read Blocks'];
  if (typeof hit === 'number' || typeof read === 'number') {
    acc.sawBuffers = true;
    acc.hit += typeof hit === 'number' ? hit : 0;
    acc.read += typeof read === 'number' ? read : 0;
  }
}

function tryJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith('[') && !t.startsWith('{')) return null;
  try {
    const v = JSON.parse(t);
    const first = Array.isArray(v) ? v[0] : v;
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ms = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parse EXPLAIN (ANALYZE, BUFFERS) output in TEXT or JSON format. CPU is never captured (null). */
export function parsePostgresPlan(text: string): ExecutionStats {
  const raw = text ?? '';
  let planMs: number | null = null;
  let execMs: number | null = null;
  const acc: Acc = { hit: 0, read: 0, sawBuffers: false };
  let plan: string | null = null;

  const json = tryJson(raw);
  if (json) {
    planMs = ms(json['Planning Time']);
    execMs = ms(json['Execution Time']);
    const root = json['Plan'];
    if (root && typeof root === 'object') {
      rootBuffers(root as Record<string, unknown>, acc);
    }
    plan = raw.trim();
  } else {
    const e = raw.match(/Execution Time:\s*([\d,.]+)\s*ms/i);
    const p = raw.match(/Planning Time:\s*([\d,.]+)\s*ms/i);
    execMs = e ? parseFloat(e[1].replace(/,/g, '')) : null;
    planMs = p ? parseFloat(p[1].replace(/,/g, '')) : null;
    // The first "Buffers:" line belongs to the root node (cumulative). Planning-phase buffers come after "Planning:".
    const planningIdx = raw.search(/^\s*Planning:\s*$/im);
    const execPart = planningIdx >= 0 ? raw.slice(0, planningIdx) : raw;
    const line = execPart.match(/^\s*Buffers:(.*)$/im);
    if (line) {
      const hit = line[1].match(/shared[^,]*?hit=(\d+)/i);
      const read = line[1].match(/shared[^,]*?read=(\d+)/i);
      const h = hit ? parseInt(hit[1], 10) : 0;
      const r = read ? parseInt(read[1], 10) : 0;
      if (hit || read) {
        acc.sawBuffers = true;
        acc.hit = h;
        acc.read = r;
      }
    }
    plan = raw.trim() || null;
  }

  const total = planMs === null && execMs === null ? null : (planMs ?? 0) + (execMs ?? 0);
  const io = acc.sawBuffers
    ? [{
        table: 'postgres_query', scanCount: 1,
        logicalReads: acc.hit + acc.read, physicalReads: acc.read, readAheadReads: 0,
        lobLogicalReads: 0, lobPhysicalReads: 0, lobReadAheadReads: 0,
      }]
    : [];

  return {
    parseAndCompileTime: planMs,
    parseAndCompileCpu: null,
    executionTime: execMs,
    executionCpu: null,
    totalElapsedMs: total,
    io,
    messages: [],
    rawOutput: raw,
    plan,
    simulated: false,
  };
}
