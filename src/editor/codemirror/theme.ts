/**
 * Editor colour schemes.
 *
 * The palette mirrors the GitHub preview styles so that the source pane and the
 * rendered pane read as one product rather than two halves bolted together.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const lightPalette = {
  background: "#ffffff",
  foreground: "#1f2328",
  gutter: "#8c959f",
  gutterActive: "#1f2328",
  lineHighlight: "#f6f8fa",
  selection: "#add6ff",
  selectionMatch: "#dfe6ec",
  cursor: "#0969da",
  panel: "#f6f8fa",
  panelBorder: "#d0d7de",
  bracket: "#0969da",
  link: "#0969da",
  code: "#0550ae",
  string: "#0a3069",
  keyword: "#cf222e",
  comment: "#6e7781",
  number: "#0550ae",
  name: "#8250df",
  meta: "#953800",
  invalid: "#82071e",
};

const darkPalette = {
  background: "#0d1117",
  foreground: "#e6edf3",
  gutter: "#6e7681",
  gutterActive: "#e6edf3",
  lineHighlight: "#161b22",
  selection: "#2f5a8f",
  selectionMatch: "#2b3a4d",
  cursor: "#58a6ff",
  panel: "#161b22",
  panelBorder: "#30363d",
  bracket: "#58a6ff",
  link: "#4493f8",
  code: "#79c0ff",
  string: "#a5d6ff",
  keyword: "#ff7b72",
  comment: "#8b949e",
  number: "#79c0ff",
  name: "#d2a8ff",
  meta: "#ffa657",
  invalid: "#ffa198",
};

type Palette = typeof lightPalette;

function buildTheme(palette: Palette, dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        color: palette.foreground,
        backgroundColor: palette.background,
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "inherit",
        overflow: "auto",
      },
      ".cm-content": {
        caretColor: palette.cursor,
        padding: "12px 0 48vh 0",
      },
      ".cm-line": {
        padding: "0 16px 0 8px",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftWidth: "2px",
        borderLeftColor: palette.cursor,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: palette.selection,
      },
      ".cm-selectionMatch": { backgroundColor: palette.selectionMatch },
      ".cm-activeLine": { backgroundColor: palette.lineHighlight },
      ".cm-activeLineGutter": {
        backgroundColor: palette.lineHighlight,
        color: palette.gutterActive,
      },
      ".cm-gutters": {
        backgroundColor: palette.background,
        color: palette.gutter,
        border: "none",
        borderRight: `1px solid ${palette.panelBorder}`,
        userSelect: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
      ".cm-foldGutter .cm-gutterElement": { padding: "0 6px 0 2px" },
      ".cm-foldPlaceholder": {
        backgroundColor: palette.panel,
        border: `1px solid ${palette.panelBorder}`,
        color: palette.gutter,
        borderRadius: "4px",
        margin: "0 4px",
        padding: "0 4px",
      },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "transparent",
        outline: `1px solid ${palette.bracket}`,
        borderRadius: "2px",
      },
      ".cm-nonmatchingBracket": { color: palette.invalid },
      ".cm-panels": {
        backgroundColor: palette.panel,
        color: palette.foreground,
        borderTop: `1px solid ${palette.panelBorder}`,
      },
      ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${palette.panelBorder}` },
      ".cm-panel.cm-search": { padding: "8px 10px" },
      ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield": {
        backgroundColor: palette.background,
        color: palette.foreground,
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: "4px",
        padding: "3px 8px",
        fontFamily: "inherit",
      },
      ".cm-panel.cm-search label": { color: palette.gutter, fontSize: "12px" },
      ".cm-button": {
        backgroundImage: "none",
        backgroundColor: palette.background,
        color: palette.foreground,
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: "4px",
        padding: "3px 10px",
        cursor: "pointer",
      },
      ".cm-tooltip": {
        backgroundColor: palette.panel,
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: "6px",
        color: palette.foreground,
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: palette.selection,
        color: dark ? palette.foreground : palette.foreground,
      },
      ".cm-searchMatch": {
        backgroundColor: dark ? "#9e6a03" : "#fff8c5",
        outline: `1px solid ${palette.panelBorder}`,
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: dark ? "#bb8009" : "#f8e3a1",
      },
      ".cm-placeholder": { color: palette.gutter },
    },
    { dark },
  );
}

function buildHighlight(palette: Palette): HighlightStyle {
  return HighlightStyle.define([
    { tag: t.heading1, color: palette.foreground, fontWeight: "700", fontSize: "1.5em" },
    { tag: t.heading2, color: palette.foreground, fontWeight: "700", fontSize: "1.32em" },
    { tag: t.heading3, color: palette.foreground, fontWeight: "600", fontSize: "1.18em" },
    { tag: t.heading4, color: palette.foreground, fontWeight: "600", fontSize: "1.08em" },
    { tag: [t.heading5, t.heading6], color: palette.foreground, fontWeight: "600" },
    { tag: t.strong, color: palette.foreground, fontWeight: "700" },
    { tag: t.emphasis, color: palette.foreground, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: palette.link, textDecoration: "underline" },
    { tag: t.monospace, color: palette.code },
    { tag: [t.keyword, t.modifier, t.operatorKeyword], color: palette.keyword },
    { tag: [t.string, t.special(t.string)], color: palette.string },
    { tag: [t.number, t.bool, t.null], color: palette.number },
    {
      tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
      color: palette.comment,
      fontStyle: "italic",
    },
    { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: palette.foreground },
    { tag: [t.function(t.variableName), t.labelName], color: palette.name },
    { tag: [t.definition(t.name), t.separator], color: palette.foreground },
    { tag: [t.typeName, t.className, t.namespace], color: palette.meta },
    { tag: [t.tagName, t.attributeName], color: palette.meta },
    { tag: [t.punctuation, t.bracket], color: palette.gutter },
    { tag: t.invalid, color: palette.invalid },
    { tag: t.quote, color: palette.comment },
    { tag: t.list, color: palette.foreground },
    { tag: t.meta, color: palette.comment },
    { tag: t.processingInstruction, color: palette.comment },
    { tag: t.contentSeparator, color: palette.gutter },
  ]);
}

export const lightTheme: Extension = [
  buildTheme(lightPalette, false),
  syntaxHighlighting(buildHighlight(lightPalette)),
];
export const darkTheme: Extension = [
  buildTheme(darkPalette, true),
  syntaxHighlighting(buildHighlight(darkPalette)),
];
