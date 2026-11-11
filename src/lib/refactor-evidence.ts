import type { AuditAnalysis } from './audit-analyzer';
import { MAX_INSTRUCTIONS_LENGTH } from './refactor-shared';

/**
 * RF-4: what the measured run found, written as refactor instructions, so the model targets the
 * evidence instead of guessing. Plain text; buildRefactorPrompt neutralises tag-like text in it.
 */
export function evidenceInstructions(analysis: AuditAnalysis): string {
  const lines: string[] = ['Measured evidence from an execution of this procedure:'];
  // Older stored analyses lack some parts; leave out what is not there.
  const v = analysis.prodVerdict;
  if (v) lines.push(`- Verdict: ${v.verdict}. ${v.reason}${v.driver ? ` (driver: ${v.driver})` : ''}`);
  const io = analysis.ioAnalysis;
  if (io?.totalLogicalReads != null) lines.push(`- Total logical reads: ${io.totalLogicalReads}.`);
  if (analysis.timeAnalysis?.totalMs != null) lines.push(`- Elapsed: ${analysis.timeAnalysis.totalMs} ms.`);
  for (const t of (io?.hotTables ?? []).slice(0, 5)) {
    lines.push(`- Table ${t.table}: ${t.logicalReads} logical reads, scan count ${t.scanCount}.`);
  }
  for (const f of (analysis.planFindings ?? []).slice(0, 5)) {
    lines.push(`- Plan finding (${f.severity}): ${f.message} ${f.recommendation}`);
  }
  lines.push('Focus the rewrite and the index recommendations on these findings. Keep the same results and parameters.');

  // Drop whole lines from the end of the evidence list rather than cutting one mid-sentence.
  const text = () => lines.join('\n');
  while (text().length > MAX_INSTRUCTIONS_LENGTH && lines.length > 3) lines.splice(lines.length - 2, 1);
  return text().slice(0, MAX_INSTRUCTIONS_LENGTH);
}
