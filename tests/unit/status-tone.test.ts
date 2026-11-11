import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRADES, VERDICT_TONE, cssVar, gradeToken, verdictTone } from '@/lib/status-tone';
import { TOKENS } from '@/lib/theme-tokens';

describe('status tones (colour-vision safe)', () => {
  it('every verdict has a token that exists in both themes and a text symbol', () => {
    for (const { token, symbol } of Object.values(VERDICT_TONE)) {
      expect(TOKENS.dark[token]).toBeTruthy();
      expect(TOKENS.light[token]).toBeTruthy();
      expect(symbol).toBeTruthy();
    }
  });

  it('gives each known verdict a distinct symbol', () => {
    const symbols = Object.values(VERDICT_TONE).map((t) => t.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('maps unknown verdicts to the insufficient-evidence tone', () => {
    expect(verdictTone('SOMETHING NEW')).toEqual(VERDICT_TONE['INSUFFICIENT EVIDENCE']);
  });

  it('maps every grade letter to its token and anything else to muted text', () => {
    for (const g of GRADES) expect(TOKENS.dark[gradeToken(g)]).toBeTruthy();
    expect(gradeToken(null)).toBe('fg.muted');
    expect(gradeToken('Z')).toBe('fg.muted');
  });

  it('builds the CSS variable name globals.css defines', () => {
    expect(cssVar('status.ok')).toBe('var(--status-ok)');
    expect(cssVar('grade.A')).toBe('var(--grade-A)');
  });
});

describe('globals.css mirrors the dark token set', () => {
  // Plain-CSS pages read these variables, so a drift from TOKENS would split Audit from Execute.
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const mirrored = Object.keys(TOKENS.dark);

  it.each(mirrored)('%s matches its CSS variable', (token) => {
    const name = `--${token.replace('.', '-')}`;
    const match = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
    expect(match?.[1].toUpperCase()).toBe(TOKENS.dark[token].toUpperCase());
  });
});
