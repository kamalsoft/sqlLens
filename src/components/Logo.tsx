/**
 * LG-1: the SQLLens mark: a magnifying lens whose glass holds a database cylinder. Decorative (the
 * "SQLLens" name is always next to it), so it is hidden from screen readers. The favicon files in
 * src/app (icon.svg, favicon.ico, apple-icon.png) are the same drawing with fixed colours.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="logo-mark">
      <rect width="64" height="64" rx="14" fill="var(--bg-canvas)" />
      <circle cx="27" cy="27" r="17" fill="var(--bg-canvas)" stroke="var(--accent-default)" strokeWidth="5" />
      <path d="M39.5 39.5 L53 53" stroke="var(--accent-default)" strokeWidth="7" strokeLinecap="round" />
      <path d="M18 20 v14 c0 2.2 4 4 9 4 s9 -1.8 9 -4 v-14 z" fill="var(--accent-solid)" />
      <ellipse cx="27" cy="20" rx="9" ry="4" fill="var(--accent-default)" />
      <path d="M18 27 c0 2.2 4 4 9 4 s9 -1.8 9 -4" fill="none" stroke="var(--bg-canvas)" strokeWidth="1.6" />
    </svg>
  );
}
