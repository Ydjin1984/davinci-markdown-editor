/**
 * Imperative bridge to the live CodeMirror view.
 *
 * Menus and dialogs need to act on the editor ("insert a table here"), but
 * threading a ref through the whole component tree would couple every menu item
 * to the editor's render lifecycle. Instead the editor registers itself here and
 * callers ask for the active view.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { codeBlock, tableBlock } from "./codemirror/commands";

let activeView: EditorView | null = null;

/**
 * Register the live editor.
 *
 * The pane clears this *before* destroying the view, so `activeEditor()` can
 * never hand out a destroyed instance.
 */
export function setActiveEditor(view: EditorView | null): void {
  activeView = view;
}

export function activeEditor(): EditorView | null {
  return activeView;
}

/** Run a CodeMirror command against the active editor, if there is one. */
export function runEditorCommand(command: (view: EditorView) => boolean): boolean {
  const view = activeEditor();
  if (!view) return false;
  const handled = command(view);
  view.focus();
  return handled;
}

export function focusEditor(): void {
  activeEditor()?.focus();
}

/** Replace the current selection with plain text, keeping the caret after it. */
export function insertText(text: string, selectionOffset = 0): boolean {
  const view = activeEditor();
  if (!view) return false;

  view.dispatch({
    changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: text },
    selection: EditorSelection.cursor(view.state.selection.main.from + selectionOffset),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function insertTable(columns = 3, rows = 2): boolean {
  return runEditorCommand(tableBlock(columns, rows));
}

export function insertCodeBlock(language = ""): boolean {
  return runEditorCommand(codeBlock(language));
}

/** Current text of the editor, or the provided fallback when it is not mounted. */
export function editorContent(fallback = ""): string {
  const view = activeEditor();
  return view ? view.state.doc.toString() : fallback;
}

/** Scroll the editor so the given 1-based line is visible and place the caret. */
export function goToLine(line: number): boolean {
  const view = activeEditor();
  if (!view) return false;

  const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
  const target = view.state.doc.line(clamped);
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    effects: [],
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Scroll the editor so the given line sits at the top of the viewport. */
export function scrollToLineTop(line: number): void {
  const view = activeEditor();
  if (!view) return;
  const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
  const target = view.state.doc.line(clamped);
  const block = view.lineBlockAt(target.from);
  view.scrollDOM.scrollTop = block.top;
}

export function editorScrollElement(): HTMLElement | null {
  return activeEditor()?.scrollDOM ?? null;
}

export { insertText as insertMarkdownText };
