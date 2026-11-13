'use client';

import { useMemo } from 'react';
import { highlightSegments, type CodeLanguage } from '@/lib/code-highlight';

/**
 * HL-2: highlighted text to put inside an existing <pre> (which keeps its own label, size and scroll).
 * Output is React text in spans, never HTML. Plain text when the language is unknown or the text is large.
 */
export function HighlightedCode({ code, language = 'auto' }: { code: string; language?: CodeLanguage }) {
  const segments = useMemo(() => highlightSegments(code, language), [code, language]);
  if (!segments) return <>{code}</>;
  return (
    <>
      {segments.map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.text}</span> : s.text))}
    </>
  );
}
