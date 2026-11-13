'use client';

import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { MSSQL, sql } from '@codemirror/lang-sql';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as placeholderExt,
} from '@codemirror/view';
import { codeHighlighter } from '@/lib/code-highlight';

const editorTheme = EditorView.theme({
  // Fills the sized host; long procedures scroll inside the box instead of stretching the page.
  '&': { height: '100%', maxWidth: '100%', backgroundColor: 'var(--bg-canvas)', color: 'var(--fg-default)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '0.875rem' },
  '&.cm-focused': { outline: '2px solid var(--accent-solid)', outlineOffset: '1px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent-default)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--bg-panel)', color: 'var(--fg-muted)', borderRight: '1px solid var(--border-subtle)', borderRadius: '8px 0 0 8px' },
  '.cm-activeLine': { backgroundColor: 'rgba(148, 163, 184, 0.08)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-raised)', color: 'var(--fg-default)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(34, 211, 238, 0.25) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(34, 211, 238, 0.2)', outline: '1px solid var(--accent-default)' },
  '.cm-placeholder': { color: 'var(--fg-muted)' },
  '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--fg-default)' },
}, { dark: true });

/** Read-only and its screen-reader state, switched together. */
function editableState(disabled: boolean) {
  return [
    EditorView.editable.of(!disabled),
    EditorState.readOnly.of(disabled),
    EditorView.contentAttributes.of(disabled ? { 'aria-readonly': 'true', 'aria-disabled': 'true' } : {}),
  ];
}

/**
 * ED-2: the shared SQL box: line numbers that stay aligned when long lines wrap, word wrap, T-SQL
 * highlighting, bracket matching, undo/redo and Ctrl/Cmd+F search. Tab is not captured, so keyboard
 * users can move on to the next field. `placeholder` and `ariaLabel` are read when it mounts; `value`,
 * `disabled` and `minHeight` follow the props. The box is 55% of the window high (at least `minHeight`),
 * can be dragged taller, and scrolls inside. Text set by the parent (for example "Use as Optimized") is not
 * added to the undo history, so Ctrl/Cmd+Z only undoes what the user typed.
 */
export function SqlEditor({ value, onChange, placeholder = '', disabled = false, minHeight = '240px', ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const editable = useRef(new Compartment());
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Created once; value and disabled changes are applied below without rebuilding the editor.
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(),
          history(), bracketMatching(), highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          sql({ dialect: MSSQL }), syntaxHighlighting(codeHighlighter),
          EditorView.lineWrapping, editorTheme,
          placeholderExt(placeholder),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true', spellcheck: 'false' }),
          editable.current.of(editableState(disabled)),
          EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once; later prop changes are dispatched below
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(editableState(disabled)),
    });
  }, [disabled]);

  // Height follows the screen (55% of the window, never below minHeight); the user can drag it taller or shorter.
  // minWidth 0 keeps it inside its column in grids and flex rows.
  return (
    <div
      ref={host} className="sql-editor" data-disabled={disabled || undefined}
      style={{ height: `max(${minHeight}, 55vh)`, minHeight, width: '100%', minWidth: 0, resize: 'vertical', overflow: 'hidden' }}
    />
  );
}
