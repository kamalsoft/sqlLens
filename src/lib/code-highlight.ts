import { jsonLanguage } from '@codemirror/lang-json';
import { MSSQL } from '@codemirror/lang-sql';
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight';

/**
 * HL-2: one token-to-class map for the SQL editor and for read-only code blocks. The colours are the
 * `.tok-*` rules in globals.css, so both always match the app theme.
 */
export const codeHighlighter = tagHighlighter([
  { tag: t.keyword, class: 'tok-keyword' },
  { tag: [t.typeName, t.standard(t.typeName)], class: 'tok-type' },
  { tag: [t.function(t.name), t.standard(t.name)], class: 'tok-function' },
  { tag: t.special(t.name), class: 'tok-variable' },
  { tag: t.propertyName, class: 'tok-property' },
  { tag: t.tagName, class: 'tok-tag' },
  { tag: t.attributeName, class: 'tok-attr' },
  { tag: [t.string, t.special(t.string), t.attributeValue], class: 'tok-string' },
  { tag: [t.number, t.bool, t.null], class: 'tok-number' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'tok-comment' },
  { tag: [t.operator, t.punctuation, t.bracket, t.angleBracket], class: 'tok-punct' },
]);

export type CodeLanguage = 'json' | 'xml' | 'sql' | 'auto';
export type Segment = { text: string; cls: string };

/**
 * Size limits (security review): JSON is checked with JSON.parse first and XML uses the linear scanner
 * below, so both may be larger; the SQL parser recovers from errors slowly on crafted input, so it gets less.
 */
export const MAX_HIGHLIGHT_CHARS = 200_000;
export const MAX_SQL_CHARS = 50_000;
/** More coloured runs than this would mean that many DOM spans: show the text plain instead. */
export const MAX_SEGMENTS = 50_000;

const PARSERS = { json: jsonLanguage.parser, sql: MSSQL.language.parser };

const NAME = /[\w:.-]/;

/**
 * XML highlighting with one forward pass: time and memory grow linearly whatever the input
 * (the lezer XML parser used quadratic memory on text such as "<<<<<<", security review).
 * Tags, attribute names, quoted values, comments and CDATA; text between tags stays plain.
 */
export function xmlSegments(code: string): Segment[] {
  const out: Segment[] = [];
  const push = (text: string, cls: string) => { if (text) out.push({ text, cls }); };
  const n = code.length;
  let i = 0;
  // Index of `marker` at or after `from`, or the end of the text.
  const upTo = (marker: string, from: number) => { const at = code.indexOf(marker, from); return at < 0 ? n : at + marker.length; };
  while (i < n) {
    if (code.startsWith('<!--', i)) { const end = upTo('-->', i + 4); push(code.slice(i, end), 'tok-comment'); i = end; continue; }
    if (code.startsWith('<![CDATA[', i)) { const end = upTo(']]>', i + 9); push(code.slice(i, end), 'tok-string'); i = end; continue; }
    if (code[i] !== '<') { const next = code.indexOf('<', i); const end = next < 0 ? n : next; push(code.slice(i, end), ''); i = end; continue; }
    // A tag: "<", "</" or "<?", its name, then attributes until ">" (or a new "<", or the end).
    let j = i + 1;
    if (code[j] === '/' || code[j] === '?' || code[j] === '!') j += 1;
    push(code.slice(i, j), 'tok-punct');
    let k = j;
    while (k < n && NAME.test(code[k])) k += 1;
    push(code.slice(j, k), 'tok-tag');
    i = k;
    while (i < n && code[i] !== '>' && code[i] !== '<') {
      const c = code[i];
      if (c === '"' || c === "'") { const end = upTo(c, i + 1); push(code.slice(i, end), 'tok-string'); i = end; continue; }
      if (NAME.test(c)) { let e = i; while (e < n && NAME.test(code[e])) e += 1; push(code.slice(i, e), 'tok-attr'); i = e; continue; }
      const punct = c === '=' || c === '/' || c === '?';
      push(c, punct ? 'tok-punct' : '');
      i += 1;
    }
    if (code[i] === '>') { push('>', 'tok-punct'); i += 1; }
  }
  return out;
}

/** True when the text is valid JSON. Fast, and it keeps malformed input away from the slow error recovery. */
function isJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

/**
 * auto: JSON or XML only when the text really is one; anything else (messages such as
 * "[dbo].[Proc] failed" or "<no rows>", prose, a cut-off model answer) stays plain.
 * - JSON must parse with JSON.parse.
 * - XML must start with `<?xml`, `<!--` or a tag, and contain a closing tag or `/>`.
 */
export function detectLanguage(code: string): 'json' | 'xml' | null {
  const text = code.trim();
  if (text.startsWith('[') || text.startsWith('{')) return isJson(text) ? 'json' : null;
  if (/^<(\?xml|!--|[A-Za-z_])/.test(text) && /<\/[A-Za-z_][\w.:-]*\s*>|\/>/.test(text)) return 'xml';
  return null;
}

const capped = (segments: Segment[]): Segment[] | null => (segments.length > MAX_SEGMENTS ? null : segments);

/** Splits code into text runs with highlight classes ('' for plain). Null when it should stay plain. */
export function highlightSegments(code: string, language: CodeLanguage): Segment[] | null {
  if (!code || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const lang = language === 'auto' ? detectLanguage(code) : language;
  if (!lang) return null;
  if (lang === 'xml') return capped(xmlSegments(code));
  if (lang === 'json' ? !isJson(code.trim()) : code.length > MAX_SQL_CHARS) return null;
  const segments: Segment[] = [];
  try {
    highlightCode(
      code, PARSERS[lang].parse(code), codeHighlighter,
      (text, cls) => segments.push({ text, cls }),
      () => segments.push({ text: '\n', cls: '' }),
    );
  } catch {
    // Very deep nesting can overflow the parser's stack: show the text plain instead of failing the page.
    return null;
  }
  return capped(segments);
}
