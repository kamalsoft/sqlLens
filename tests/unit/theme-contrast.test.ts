import { describe, expect, it } from 'vitest';
import { contrastRatio, TEXT_ON_BACKGROUND, TOKENS, type ThemeMode } from '@/lib/theme-tokens';

describe('theme contrast (UX-DESIGN-1)', () => {
  for (const mode of ['dark', 'light'] as ThemeMode[]) {
    it(`every text pair reaches WCAG AA in ${mode} mode`, () => {
      const failures = TEXT_ON_BACKGROUND
        .map((p) => ({ ...p, ratio: contrastRatio(TOKENS[mode][p.text], TOKENS[mode][p.bg]) }))
        .filter((p) => p.ratio < 4.5)
        .map((p) => `${p.text} on ${p.bg}: ${p.ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }

  it('the token sets define the same names in both modes', () => {
    expect(Object.keys(TOKENS.light).sort()).toEqual(Object.keys(TOKENS.dark).sort());
  });

  it('builds the Chakra system from the token set without error', async () => {
    const { sqllensSystem } = await import('@/lib/theme');
    expect(sqllensSystem.token('colors.bg.canvas')).toBeDefined();
  });
});
