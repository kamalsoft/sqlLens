/**
 * UX-DESIGN-1: one colour token set for dark and light. Plain data, so the contrast test can check
 * every text and background pair the UI uses. The Chakra theme (src/lib/theme.ts) is built from it.
 * Dark is the default; light follows the user's system setting once the toggle is wired.
 */
export type ThemeMode = 'dark' | 'light';

export const TOKENS: Record<ThemeMode, Record<string, string>> = {
  dark: {
    'bg.canvas': '#0F172A',   // page
    'bg.panel': '#1E293B',    // cards and panels
    'bg.raised': '#273449',   // inputs, hover, nested blocks
    'bg.code': '#020617',     // SQL and raw output
    'fg.default': '#E2E8F0',  // primary text
    'fg.muted': '#94A3B8',    // labels, hints, captions
    'fg.onAccent': '#0F172A', // text on the accent colour
    'border.subtle': '#334155',
    'accent.default': '#22D3EE', // links, focus, active tab text
    'accent.solid': '#0891B2',   // primary button background (dark text on it: 4.85:1)
    'status.ok': '#4ADE80',
    'status.warn': '#FACC15',
    'status.bad': '#F87171',
  },
  light: {
    'bg.canvas': '#F8FAFC',
    'bg.panel': '#FFFFFF',
    'bg.raised': '#F1F5F9',
    'bg.code': '#E2E8F0',
    'fg.default': '#0F172A',
    'fg.muted': '#475569',
    'fg.onAccent': '#FFFFFF',
    'border.subtle': '#CBD5E1',
    'accent.default': '#0E7490',
    'accent.solid': '#0E7490',
    'status.ok': '#15803D',
    'status.warn': '#A16207',
    'status.bad': '#B91C1C',
  },
};

/** Text on background pairs the UI relies on. Each must reach WCAG AA (4.5:1) in its mode. */
export const TEXT_ON_BACKGROUND: { text: string; bg: string }[] = [
  { text: 'fg.default', bg: 'bg.canvas' },
  { text: 'fg.default', bg: 'bg.panel' },
  { text: 'fg.default', bg: 'bg.raised' },
  { text: 'fg.default', bg: 'bg.code' },
  { text: 'fg.muted', bg: 'bg.canvas' },
  { text: 'fg.muted', bg: 'bg.panel' },
  { text: 'fg.muted', bg: 'bg.raised' },
  { text: 'accent.default', bg: 'bg.canvas' },
  { text: 'accent.default', bg: 'bg.panel' },
  { text: 'fg.onAccent', bg: 'accent.solid' },
  { text: 'status.ok', bg: 'bg.panel' },
  { text: 'status.warn', bg: 'bg.panel' },
  { text: 'status.bad', bg: 'bg.panel' },
];

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
