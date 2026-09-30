/**
 * Markdown formatting commands for the editor.
 *
 * Every command is written against `changeByRange`, so it applies to all
 * selections at once — multi-cursor editing is a first-class path rather than a
 * special case. Each command is also a toggle: running it on already-formatted
 * text removes the formatting.
 */

import type { ChangeSpec, EditorState, SelectionRange } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

/** Result of transforming one selection. */
interface RangeEdit {
  changes: ChangeSpec;
  range: SelectionRange;
}

type RangeTransform = (range: SelectionRange, state: EditorState) => RangeEdit;

function runCommand(view: EditorView, transform: RangeTransform): boolean {
  const { state } = view;
  const spec = state.changeByRange((range) => transform(range, state));

  // A no-op transformation (for example toggling off at an unformatted cursor)
  // still produces a change; only skip when nothing at all would move.
  if (spec.changes.empty) return false;

  view.dispatch(spec);
  view.focus();
  return true;
}

/** Expand a selection to cover whole lines. */
function lineSpan(range: SelectionRange, state: EditorState): { from: number; to: number } {
  const from = state.doc.lineAt(range.from).from;
  const to = state.doc.lineAt(range.to).to;
  return { from, to };
}

/**
 * Toggle a symmetric inline marker such as `**` or `~~`.
 *
 * With no selection the markers are inserted and the caret placed between them.
 */
function toggleMarker(marker: string, closing = marker): RangeTransform {
  return (range, state) => {
    const outerFrom = Math.max(0, range.from - marker.length);
    const outerTo = Math.min(state.doc.length, range.to + closing.length);
    const before = state.sliceDoc(outerFrom, range.from);
    const after = state.sliceDoc(range.to, outerTo);

    // Remove the marker when the selection is already wrapped.
    if (before === marker && after === closing && range.from !== range.to) {
      return {
        changes: [
          { from: outerFrom, to: range.from, insert: "" },
          { from: range.to, to: outerTo, insert: "" },
        ],
        range: EditorSelection.range(outerFrom, range.to - marker.length),
      };
    }

    // Toggle off when the cursor sits inside a wrapped span with no selection.
    const line = state.doc.lineAt(range.from);
    const lineText = state.sliceDoc(line.from, line.to);
    const offset = range.from - line.from;
    const openIndex = lineText.lastIndexOf(marker, offset - 1);
    if (
      range.from === range.to &&
      openIndex !== -1 &&
      lineText.startsWith(closing, offset) &&
      lineText.indexOf(marker, openIndex + marker.length) >= offset
    ) {
      const closeIndex = lineText.indexOf(closing, offset);
      return {
        changes: { from: line.from + closeIndex, to: line.from + closeIndex + closing.length, insert: "" },
        range: EditorSelection.cursor(range.from),
      };
    }

    if (range.from === range.to) {
      return {
        changes: { from: range.from, insert: marker + closing },
        range: EditorSelection.cursor(range.from + marker.length),
      };
    }

    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: closing },
      ],
      range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
    };
  };
}

/**
 * Toggle a line prefix such as `> ` or `- `.
 *
 * When every selected line already starts with the prefix it is removed;
 * otherwise it is added to the lines that lack it.
 */
function toggleLinePrefix(prefix: string, options: { ordered?: boolean } = {}): RangeTransform {
  return (range, state) => {
    const { from, to } = lineSpan(range, state);
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    const lines = [];
    for (let number = first.number; number <= last.number; number += 1) {
      lines.push(state.doc.line(number));
    }

    const matches = (text: string): boolean => {
      if (options.ordered) return /^\s*\d+\.\s/.test(text);
      return text.startsWith(prefix) && !/^\s/.test(text);
    };

    const allPrefixed = lines.every((line) => matches(line.text));
    const changes: ChangeSpec[] = [];

    lines.forEach((line, index) => {
      if (allPrefixed) {
        if (options.ordered) {
          const match = /^(\s*)\d+\.\s/.exec(line.text);
          if (match) {
            changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] ?? "" });
          }
        } else {
          changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
        }
        return;
      }

      if (matches(line.text)) return;
      const insert = options.ordered ? `${index + 1}. ` : prefix;
      changes.push({ from: line.from, insert });
    });

    if (changes.length === 0) return { changes: [], range };

    return {
      changes,
      range: EditorSelection.range(from, to),
    };
  };
}

function wrapSelectionWithLink(): RangeTransform {
  return (range, state) => {
    const selected = state.sliceDoc(range.from, range.to);
    const label = selected || "link text";
    const insert = `[${label}](url)`;
    const urlStart = range.from + label.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      // Select the placeholder URL so the next keystroke replaces it.
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  };
}

function insertImage(): RangeTransform {
  return (range, state) => {
    const selected = state.sliceDoc(range.from, range.to);
    const alt = selected || "alt text";
    const insert = `![${alt}](path/to/image.png)`;
    const pathStart = range.from + alt.length + 4;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(pathStart, pathStart + "path/to/image.png".length),
    };
  };
}

export const toggleBold: Command = (view) => runCommand(view, toggleMarker("**"));
export const toggleItalic: Command = (view) => runCommand(view, toggleMarker("*"));
export const toggleStrikethrough: Command = (view) => runCommand(view, toggleMarker("~~"));
export const toggleInlineCode: Command = (view) => runCommand(view, toggleMarker("`"));
export const toggleHighlight: Command = (view) => runCommand(view, toggleMarker("=="));

export const toggleBlockquote: Command = (view) => runCommand(view, toggleLinePrefix("> "));
export const toggleBulletList: Command = (view) => runCommand(view, toggleLinePrefix("- "));
export const toggleOrderedList: Command = (view) => runCommand(view, toggleLinePrefix("", { ordered: true }));

export function setHeading(level: number): Command {
  return (view) =>
    runCommand(view, (range, state) => {
      const { from, to } = lineSpan(range, state);
      const line = state.doc.lineAt(from);
      const existing = /^(#{1,6})\s+/.exec(line.text);
      const prefix = level > 0 ? `${"#".repeat(level)} ` : "";

      if (existing && existing[1]?.length === level) {
        return {
          changes: { from: line.from, to: line.from + existing[0].length, insert: "" },
          range: EditorSelection.range(from, to - existing[0].length),
        };
      }

      const removeLength = existing ? existing[0].length : 0;
      return {
        changes: { from: line.from, to: line.from + removeLength, insert: prefix },
        range: EditorSelection.range(from - removeLength + prefix.length, to - removeLength + prefix.length),
      };
    });
}

export const toggleTaskList: Command = (view) =>
  runCommand(view, (range, state) => {
    const { from, to } = lineSpan(range, state);
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    const changes: ChangeSpec[] = [];
    let anyUnchecked = false;

    for (let number = first.number; number <= last.number; number += 1) {
      const line = state.doc.line(number);
      const match = /^(\s*)(?:[-*+]\s+)?\[([ xX])\]\s+/.exec(line.text);
      if (match) {
        const index = match[0].length;
        const checked = (match[2] ?? " ").toLowerCase() === "x";
        changes.push({
          from: line.from,
          to: line.from + index,
          insert: `${match[1] ?? ""}- [${checked ? " " : "x"}] `,
        });
      } else {
        anyUnchecked = true;
        const listMatch = /^(\s*)(?:[-*+]\s+)?/.exec(line.text);
        changes.push({
          from: line.from,
          to: line.from + (listMatch?.[0].length ?? 0),
          insert: `${listMatch?.[1] ?? ""}- [ ] `,
        });
      }
    }

    void anyUnchecked;
    return { changes, range: EditorSelection.range(from, to) };
  });

export const insertLink = (view: EditorView) => runCommand(view, wrapSelectionWithLink());
export const insertImageCommand = (view: EditorView) => runCommand(view, insertImage());

export const toggleHorizontalRule: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.to);
  const insert = line.text.trim().length === 0 ? "---\n" : "\n\n---\n";
  return runCommand(view, () => ({
    changes: { from: line.to, insert },
    range: EditorSelection.cursor(line.to + insert.length),
  }));
};

/** Insert a fenced block on its own lines, keeping the caret inside it. */
export function insertBlock(lines: string[], placeholderFrom: number, placeholderTo?: number): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;

    const before = state.sliceDoc(0, range.from);
    const after = state.sliceDoc(range.to);
    const leading =
      before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trailing =
      after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const block = `${leading}${lines.join("\n")}${trailing}`;

    const from = range.from;
    const to = placeholderTo ?? placeholderFrom;

    view.dispatch({
      changes: { from: range.from, to: range.to, insert: block },
      selection: EditorSelection.range(from + leading.length + placeholderFrom, from + leading.length + to),
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };
}

export function tableBlock(columns: number, rows: number): Command {
  const header = `| ${Array.from({ length: columns }, (_, index) => `Header ${index + 1}`).join(" | ")} |`;
  const divider = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  const body = Array.from(
    { length: Math.max(rows, 1) },
    () => `| ${Array.from({ length: columns }, () => "   ").join(" | ")} |`,
  );
  const lines = [header, divider, ...body];
  // Put the caret on the first header cell so the user can start typing.
  return insertBlock(lines, 2, 2 + "Header 1".length);
}

export function codeBlock(language: string): Command {
  const fence = `\`\`\`${language}`;
  return insertBlock([fence, "", "```"], fence.length + 1);
}

export function mermaidBlock(source: string): Command {
  return insertBlock(["```mermaid", ...source.split("\n"), "```"], 12, 12);
}
