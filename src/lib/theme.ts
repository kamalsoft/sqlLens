import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { TOKENS } from './theme-tokens';

const color = (name: string) => ({
  value: { base: TOKENS.light[name], _dark: TOKENS.dark[name] },
});

/** The Chakra system built from the token set. Not yet applied to the pages (see UX-DESIGN-1). */
export const sqllensSystem = createSystem(defaultConfig, defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        'bg.canvas': color('bg.canvas'),
        'bg.panel': color('bg.panel'),
        'bg.raised': color('bg.raised'),
        'bg.code': color('bg.code'),
        'fg.default': color('fg.default'),
        'fg.muted': color('fg.muted'),
        'fg.onAccent': color('fg.onAccent'),
        'border.subtle': color('border.subtle'),
        'accent.default': color('accent.default'),
        'accent.solid': color('accent.solid'),
        'status.ok': color('status.ok'),
        'status.warn': color('status.warn'),
        'status.bad': color('status.bad'),
      },
    },
  },
}));
