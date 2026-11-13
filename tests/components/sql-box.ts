import { act, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

// ED-3: SQL boxes are CodeMirror editors; jsdom cannot type into them, so tests edit them directly.
function view(name: string): EditorView {
  const content = screen.getByRole("textbox", { name });
  return EditorView.findFromDOM(content.closest(".cm-editor") as HTMLElement)!;
}

/** Appends text to the SQL editor with this accessible name, like typing at the end. */
export async function typeSql(name: string, text: string): Promise<void> {
  await screen.findByRole("textbox", { name });
  const v = view(name);
  act(() => v.dispatch({ changes: { from: v.state.doc.length, insert: text } }));
}

/** The current text of the SQL editor with this accessible name. */
export const sqlValue = (name: string): string => view(name).state.doc.toString();
