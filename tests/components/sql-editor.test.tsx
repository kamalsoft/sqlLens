// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "@codemirror/commands";
import { SqlEditor } from "@/components/SqlEditor";

afterEach(cleanup);

const content = (name: string) => screen.getByRole("textbox", { name });
const viewOf = (name: string) => EditorView.findFromDOM(content(name).closest(".cm-editor") as HTMLElement)!;

describe("SqlEditor (ED-2)", () => {
  it("shows the SQL with line numbers, wraps lines, and highlights T-SQL", () => {
    render(<SqlEditor ariaLabel="Stored procedure" value={"SELECT TOP (5) @Id, 'x' -- note\nFROM dbo.Orders"} onChange={() => {}} />);
    const box = content("Stored procedure");
    expect(box).toHaveAttribute("aria-multiline", "true");
    expect(box.closest(".cm-editor")!.querySelector(".cm-lineNumbers")!.textContent).toContain("12");
    expect(box.classList.contains("cm-lineWrapping")).toBe(true);
    // Highlighted tokens get generated classes; keywords and strings differ from plain text.
    const spans = Array.from(box.querySelectorAll("span")).map((s) => [s.textContent, s.className]);
    const cls = (text: string) => spans.find(([t]) => t === text)?.[1];
    expect(cls("SELECT")).toBeTruthy();
    expect(cls("'x'")).toBeTruthy();
    expect(cls("SELECT")).not.toBe(cls("'x'"));
    expect(cls("-- note")).toBeTruthy();
  });

  it("reports edits and follows value changes from the parent", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SqlEditor ariaLabel="SQL" value="SELECT 1" onChange={onChange} />);
    const v = viewOf("SQL");
    v.dispatch({ changes: { from: v.state.doc.length, insert: ";" } });
    expect(onChange).toHaveBeenLastCalledWith("SELECT 1;");
    expect(undoDepth(v.state)).toBe(1);
    rerender(<SqlEditor ariaLabel="SQL" value="SELECT 2" onChange={onChange} />);
    expect(v.state.doc.toString()).toBe("SELECT 2");
    // Text set by the parent is not undoable: Ctrl/Cmd+Z cannot bring back the replaced text.
    undo(v);
    expect(v.state.doc.toString()).toBe("SELECT 2");
  });

  it("works as a controlled field", () => {
    function Host() {
      const [sql, setSql] = useState("");
      return (<><SqlEditor ariaLabel="SQL" value={sql} onChange={setSql} /><output>{sql.length}</output></>);
    }
    render(<Host />);
    act(() => viewOf("SQL").dispatch({ changes: { from: 0, insert: "EXEC dbo.p" } }));
    expect(screen.getByRole("status").textContent).toBe("10");
  });

  it("is read-only when disabled", () => {
    const { rerender } = render(<SqlEditor ariaLabel="SQL" value="SELECT 1" onChange={() => {}} disabled />);
    expect(content("SQL")).toHaveAttribute("contenteditable", "false");
    expect(viewOf("SQL").state.readOnly).toBe(true);
    expect(content("SQL")).toHaveAttribute("aria-readonly", "true");
    rerender(<SqlEditor ariaLabel="SQL" value="SELECT 1" onChange={() => {}} />);
    expect(content("SQL")).toHaveAttribute("contenteditable", "true");
  });

  it("is sized to the screen and scrolls inside instead of growing the page", () => {
    render(<SqlEditor ariaLabel="SQL" value={"SELECT 1\n".repeat(500)} onChange={() => {}} minHeight="280px" />);
    const host = content("SQL").closest(".sql-editor") as HTMLElement;
    expect(host.style.height).toBe("max(280px, 55vh)");
    expect(host.style.minHeight).toBe("280px");
    expect(host.style.overflow).toBe("hidden");
    expect(host.style.resize).toBe("vertical");
    expect(host.style.minWidth).toBe("0px");
  });

  it("shows the placeholder when empty", () => {
    render(<SqlEditor ariaLabel="SQL" value="" onChange={() => {}} placeholder="CREATE PROCEDURE dbo.GetOrders" />);
    expect(screen.getByText("CREATE PROCEDURE dbo.GetOrders")).toBeInTheDocument();
  });
});
