import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { TOKENS } from './theme-tokens';

type Leaf = { value: { base: string; _dark: string } };
type Tree = { [key: string]: Leaf | Tree };

const leaf = (name: string): Leaf => ({ value: { base: TOKENS.light[name], _dark: TOKENS.dark[name] } });

/** Every token in the set becomes a Chakra semantic colour ('bg.canvas' -> colors.bg.canvas), so the list cannot drift. */
const colors: Tree = {};
for (const name of Object.keys(TOKENS.dark)) {
  const [group, key] = name.split('.');
  colors[group] = { ...(colors[group] as Tree), [key]: leaf(name) };
}

/** Chakra's own defaults (a bare border, the page, stock neutrals) point at the same tokens. */
const alias = (group: string, keys: Record<string, string>) => {
  colors[group] = { ...(colors[group] as Tree), ...Object.fromEntries(Object.entries(keys).map(([k, name]) => [k, leaf(name)])) };
};
alias('bg', { DEFAULT: 'bg.canvas', subtle: 'bg.panel', muted: 'bg.raised', emphasized: 'bg.raised' });
alias('fg', { DEFAULT: 'fg.default', subtle: 'fg.muted' });
alias('border', { DEFAULT: 'border.subtle', muted: 'border.subtle', emphasized: 'border.subtle' });

/** The one accent palette for buttons, badges and tabs: colorPalette="brand" on every screen. */
alias('brand', {
  solid: 'accent.solid', contrast: 'fg.onAccent', fg: 'accent.default', muted: 'border.subtle',
  subtle: 'bg.raised', emphasized: 'border.subtle', focusRing: 'accent.default', border: 'border.subtle',
});
/** The neutral palette (colorPalette="gray"), from the same tokens instead of Chakra's stock grey. */
alias('gray', {
  solid: 'bg.raised', contrast: 'fg.default', fg: 'fg.default', muted: 'border.subtle',
  subtle: 'bg.raised', emphasized: 'border.subtle', focusRing: 'accent.default', border: 'border.subtle',
});

/** The Chakra system built from the token set. */
export const sqllensSystem = createSystem(defaultConfig, defineConfig({
  theme: { semanticTokens: { colors } },
}));
