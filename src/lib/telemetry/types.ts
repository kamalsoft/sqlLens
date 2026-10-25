/** Telemetry types (contract C11). null = not captured; never an estimate. */

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
  parseAndCompileTime: number | null; // ms
  parseAndCompileCpu: number | null;  // ms
  executionTime: number | null;       // ms (elapsed)
  executionCpu: number | null;        // ms
  totalElapsedMs: number | null;
  io: StatisticsIORow[];
  messages: string[];
  rawOutput: string;
  /** XML or JSON plan text, when captured. */
  plan?: string | null;
  /** True when produced by the labeled simulation (D-004). */
  simulated: boolean;
}
