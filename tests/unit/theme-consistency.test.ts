import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every screen takes its colours from the one token set (src/lib/theme-tokens.ts). These checks fail
 * when a page or the stylesheet brings its own colour back.
 */
const root = process.cwd();
const screens = ['src/app', 'src/components'].flatMap((dir) =>
  (readdirSync(join(root, dir), { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(dir, f)));

const PALETTE = /['"`](gray|red|green|yellow|orange|blue|cyan|purple|pink|teal)\.\d{2,3}['"`]/;
const HEX = /#[0-9a-fA-F]{6}\b/;
const OWN_PALETTE = /colorPalette=["'](?!brand["']|gray["'])/;

describe('one colour system on every screen', () => {
  it.each(screens)('%s uses tokens, not its own colours', (file) => {
    const offending = readFileSync(join(root, file), 'utf8').split('\n')
      .filter((line) => PALETTE.test(line) || HEX.test(line) || OWN_PALETTE.test(line));
    expect(offending).toEqual([]);
  });

  it('globals.css keeps hex colours inside the :root token block only', () => {
    const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
    const rules = css.replace(/:root \{[\s\S]*?\n\}\n/, '');
    // Black and white with alpha are allowed: they are shadows and overlays, not part of the palette.
    const own = (line: string) => /#[0-9a-fA-F]{3,8}\b/.test(line)
      || /rgba?\((?!\s*(0,\s*0,\s*0|255,\s*255,\s*255)\b)/.test(line);
    expect(rules.split('\n').filter(own)).toEqual([]);
  });
});
