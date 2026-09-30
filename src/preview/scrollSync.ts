/**
 * Editor ↔ preview scroll synchronisation.
 *
 * Both panes carry the source line of every block (`data-line` in the preview,
 * CodeMirror line blocks in the editor), so the mapping is proportional between
 * consecutive anchors rather than a naive percentage — which is what keeps the
 * panes together across a long code block or diagram.
 *
 * A direction lock prevents the two scroll handlers from echoing each other.
 */

import type { EditorView } from "@codemirror/view";

/** Ignore incoming scroll events for this long after we moved a pane ourselves. */
const ECHO_WINDOW_MS = 120;

export interface Anchor {
  line: number;
  top: number;
}

let echoUntil = 0;
let echoSource: "editor" | "preview" | null = null;

function claim(source: "editor" | "preview"): boolean {
  const now = performance.now();
  if (now < echoUntil && echoSource !== source) return false;
  echoUntil = now + ECHO_WINDOW_MS;
  echoSource = source;
  return true;
}

/** Collect preview anchors, sorted by source line. */
export function collectAnchors(container: HTMLElement): Anchor[] {
  const containerTop = container.getBoundingClientRect().top - container.scrollTop;
  const anchors: Anchor[] = [];

  for (const element of container.querySelectorAll<HTMLElement>("[data-line]")) {
    const line = Number(element.dataset.line);
    if (!Number.isFinite(line) || line <= 0) continue;
    anchors.push({ line, top: element.getBoundingClientRect().top - containerTop });
  }

  anchors.sort((a, b) => a.line - b.line || a.top - b.top);
  return anchors;
}

function interpolate(
  anchors: Anchor[],
  value: number,
  valueKey: "line" | "top",
  targetKey: "line" | "top",
): number {
  if (anchors.length === 0) return value;

  let index = 0;
  for (let i = 0; i < anchors.length; i += 1) {
    if (anchors[i]![valueKey] <= value) index = i;
    else break;
  }

  const current = anchors[index]!;
  const next = anchors[index + 1];

  if (!next || next[valueKey] === current[valueKey]) {
    return current[targetKey] + (value - current[valueKey]);
  }

  const ratio = (value - current[valueKey]) / (next[valueKey] - current[valueKey]);
  return current[targetKey] + ratio * (next[targetKey] - current[targetKey]);
}

/** Top visible source line in the editor. */
export function editorTopLine(view: EditorView): number {
  const range = view.visibleRanges[0];
  if (!range) return 1;
  return view.state.doc.lineAt(range.from).number;
}

/**
 * Scroll the preview to match the editor.
 *
 * Returns `false` when the move was suppressed as an echo of the reverse
 * direction, so callers can skip the work entirely.
 */
export function syncEditorToPreview(view: EditorView, container: HTMLElement, anchors: Anchor[]): boolean {
  if (anchors.length === 0) return false;
  if (!claim("editor")) return false;

  // Only the first visible line matters; a partially scrolled block above it
  // would make the mapping jitter.
  const line = editorTopLine(view);
  const block = view.lineBlockAt(view.visibleRanges[0]?.from ?? 0);
  const offsetWithinBlock = view.scrollDOM.scrollTop - view.documentTop - block.top;

  const targetTop = interpolate(anchors, line, "line", "top") + Math.max(offsetWithinBlock, 0);
  container.scrollTop = targetTop;
  return true;
}

/** Scroll the editor to match the preview. */
export function syncPreviewToEditor(view: EditorView, container: HTMLElement, anchors: Anchor[]): boolean {
  if (anchors.length === 0) return false;
  if (!claim("preview")) return false;

  const line = interpolate(anchors, container.scrollTop, "top", "line");
  const clamped = Math.min(Math.max(Math.round(line), 1), view.state.doc.lines);
  const block = view.lineBlockAt(view.state.doc.line(clamped).from);
  view.scrollDOM.scrollTop = block.top + view.documentTop;
  return true;
}

/** Reset the echo lock, for example after switching documents. */
export function resetScrollSync(): void {
  echoUntil = 0;
  echoSource = null;
}
