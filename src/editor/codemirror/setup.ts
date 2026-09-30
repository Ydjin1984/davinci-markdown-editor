/**
 * CodeMirror 6 configuration.
 *
 * Dynamic settings live in compartments so changing the font size or switching
 * the theme reconfigures the live editor instead of recreating it — which would
 * lose the cursor, the scroll position and the undo history.
 */

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap, openSearchPanel } from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

import { darkTheme, lightTheme } from "./theme";
import { markdownCompletionSources } from "./completions";
import {
  codeBlock,
  insertImageCommand,
  insertLink,
  setHeading,
  tableBlock,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleTaskList,
} from "./commands";
import type { EditorSettings } from "@/shared/types";

export interface EditorCompartments {
  appearance: Compartment;
  layout: Compartment;
  typography: Compartment;
  readOnly: Compartment;
}

export function createCompartments(): EditorCompartments {
  return {
    appearance: new Compartment(),
    layout: new Compartment(),
    typography: new Compartment(),
    readOnly: new Compartment(),
  };
}

export function appearanceExtensions(appearance: "light" | "dark"): Extension {
  return appearance === "dark" ? darkTheme : lightTheme;
}

export function layoutExtensions(settings: EditorSettings): Extension {
  const parts: Extension[] = [];

  if (settings.lineNumbers) {
    parts.push(lineNumbers(), highlightActiveLineGutter());
  }
  if (settings.highlightActiveLine) {
    parts.push(highlightActiveLine());
  }
  if (settings.bracketMatching) {
    parts.push(bracketMatching());
  }
  if (settings.codeFolding) {
    parts.push(foldGutter());
  }
  if (settings.wordWrap) {
    parts.push(EditorView.lineWrapping);
  }

  return parts;
}

export function typographyExtensions(settings: EditorSettings): Extension {
  const family = settings.fontFamily.trim() || "monospace";
  const indent = settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t";

  return [
    EditorState.tabSize.of(settings.tabSize),
    indentUnit.of(indent),
    EditorView.theme({
      ".cm-scroller": {
        fontFamily: family,
        fontSize: `${settings.fontSize}px`,
        lineHeight: String(settings.lineHeight),
      },
      ".cm-gutters": {
        fontFamily: family,
        fontSize: `${Math.max(settings.fontSize - 1, 9)}px`,
      },
    }),
  ];
}

export function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/** Actions the editor keymap forwards to the application shell. */
export interface EditorCallbacks {
  onOpenSearch: () => void;
  onTogglePreview: () => void;
}

export interface EditorSetupOptions {
  settings: EditorSettings;
  appearance: "light" | "dark";
  readOnly: boolean;
  compartments: EditorCompartments;
  callbacks: EditorCallbacks;
  onDocChanged: () => void;
  onSelectionChanged: () => void;
}

export function createEditorExtensions(options: EditorSetupOptions): Extension[] {
  const { settings, appearance, readOnly, compartments, callbacks } = options;

  const markdownKeymap = keymap.of([
    { key: "Mod-b", run: toggleBold, preventDefault: true },
    { key: "Mod-i", run: toggleItalic, preventDefault: true },
    { key: "Mod-e", run: toggleInlineCode, preventDefault: true },
    { key: "Mod-Shift-x", run: toggleStrikethrough, preventDefault: true },
    { key: "Mod-k", run: insertLink, preventDefault: true },
    { key: "Mod-Shift-k", run: insertImageCommand, preventDefault: true },
    { key: "Mod-Shift-8", run: toggleBulletList, preventDefault: true },
    { key: "Mod-Shift-7", run: toggleOrderedList, preventDefault: true },
    { key: "Mod-Shift-9", run: toggleTaskList, preventDefault: true },
    { key: "Mod-Shift-.", run: toggleBlockquote, preventDefault: true },
    { key: "Mod-Shift-1", run: setHeading(1), preventDefault: true },
    { key: "Mod-Shift-2", run: setHeading(2), preventDefault: true },
    { key: "Mod-Shift-3", run: setHeading(3), preventDefault: true },
    { key: "Mod-Shift-4", run: setHeading(4), preventDefault: true },
    { key: "Mod-Shift-0", run: setHeading(0), preventDefault: true },
    { key: "Mod-h", run: openSearchPanel, preventDefault: true },
    {
      key: "Mod-Shift-v",
      run: () => {
        callbacks.onTogglePreview();
        return true;
      },
      preventDefault: true,
    },
  ]);

  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    closeBrackets(),
    autocompletion({ override: markdownCompletionSources, activateOnTyping: true }),
    bracketMatching(),
    highlightSelectionMatches(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChanged();
      if (update.selectionSet || update.docChanged) options.onSelectionChanged();
    }),
    markdownKeymap,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    markdown({
      base: markdownLanguage,
      // Fenced code inside the document is highlighted with the same grammar
      // set the preview uses, loaded on demand by CodeMirror.
      codeLanguages: languages,
      addKeymap: true,
    }),
    placeholder("Write Markdown here…"),
    compartments.appearance.of(appearanceExtensions(appearance)),
    compartments.layout.of(layoutExtensions(settings)),
    compartments.typography.of(typographyExtensions(settings)),
    compartments.readOnly.of(readOnlyExtensions(readOnly)),
  ];
}

/** Convenience for tests and one-off documents. */
export function createState(options: EditorSetupOptions, doc: string): EditorState {
  return EditorState.create({ doc, extensions: createEditorExtensions(options) });
}

export type { Extension };

export const commandHelpers = {
  codeBlock,
  tableBlock,
};
