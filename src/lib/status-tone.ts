/**
 * One meaning per grade and verdict, shared by the Execute and Audit pages. Colours are theme tokens
 * (theme-tokens.ts), chosen from a colour-vision-safe palette. The symbol is a second cue, so the
 * state never depends on colour alone.
 */
export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;

export const VERDICT_TONE: Record<string, { token: string; symbol: string }> = {
  READY: { token: 'status.ok', symbol: '✓' },
  OPTIMIZE: { token: 'status.warn', symbol: '▲' },
  UNSTABLE: { token: 'status.bad', symbol: '✕' },
  'INSUFFICIENT EVIDENCE': { token: 'status.info', symbol: '?' },
};

export function verdictTone(verdict: string) {
  return VERDICT_TONE[verdict] ?? VERDICT_TONE['INSUFFICIENT EVIDENCE'];
}

/** The token for a grade letter, or muted text when the run was not graded. */
export function gradeToken(grade: string | null): string {
  return grade !== null && (GRADES as readonly string[]).includes(grade) ? `grade.${grade}` : 'fg.muted';
}

/** The CSS variable that globals.css defines for a token, for plain-CSS pages. */
export function cssVar(token: string): string {
  return `var(--${token.replace('.', '-')})`;
}
