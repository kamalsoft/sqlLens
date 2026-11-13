import { jsonLanguage } from '@codemirror/lang-json';
import { MSSQL } from '@codemirror/lang-sql';
import { xmlLanguage } from '@codemirror/lang-xml';
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
 * Size limits before parsing (security review): JSON is checked with JSON.parse first, so it can be larger;
 * the XML and SQL parsers recover from errors slowly on crafted input, so they get a lower limit.
 */
export const MAX_HIGHLIGHT_CHARS = 200_000;
export const MAX_XML_SQL_CHARS = 50_000;

const PARSERS = { json: jsonLanguage.parser, xml: xmlLanguage.parser, sql: MSSQL.language.parser };

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

/** Splits code into text runs with highlight classes ('' for plain). Null when it should stay plain. */
export function highlightSegments(code: string, language: CodeLanguage): Segment[] | null {
  if (!code || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const lang = language === 'auto' ? detectLanguage(code) : language;
  if (!lang) return null;
  if (lang === 'json' ? !isJson(code.trim()) : code.length > MAX_XML_SQL_CHARS) return null;
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
  return segments;
}
