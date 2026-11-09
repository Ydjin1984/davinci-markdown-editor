/**
 * CodeMirror grammar for each document kind.
 *
 * Markdown keeps its completion sources and formatting keymap; the structured
 * formats get their own grammar, and CSV/LOG — which have no CodeMirror package —
 * get a small streaming highlighter. Nothing here changes the text.
 */

import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { xml } from "@codemirror/lang-xml";
import { keymap } from "@codemirror/view";

import type { EditorLanguage } from "@/documents/types";
import { markdownCompletionSources } from "./completions";
import {
  insertImageCommand,
  insertLink,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleTaskList,
} from "./commands";

/** Formatting shortcuts only make sense inside Markdown. */
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
]);

/** Grammar plus the language-specific extensions, ready for a compartment. */
export function languageExtensions(language: EditorLanguage): Extension {
  switch (language) {
    case "markdown":
      return [
        markdown({
          base: markdownLanguage,
          // Fenced code inside the document is highlighted with the same
          // grammar set the preview uses, loaded on demand by CodeMirror.
          codeLanguages: languages,
          addKeymap: true,
        }),
        markdownKeymap,
        autocompletion({ override: markdownCompletionSources, activateOnTyping: true }),
      ];
    case "json":
      return json();
    case "xml":
      return xml();
    case "csv":
      return StreamLanguage.define(csvParser());
    case "log":
      return StreamLanguage.define(logParser());
    case "text":
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

interface CsvHighlighterState {
  /** A quoted field is open and continues on the next line. */
  quoted: boolean;
}

function csvParser(): StreamParser<CsvHighlighterState> {
  return {
    name: "csv",
    startState: () => ({ quoted: false }),
    copyState: (state) => ({ quoted: state.quoted }),
    token(stream: StringStream, state: CsvHighlighterState): string | null {
      if (state.quoted) {
        while (!stream.eol()) {
          const character = stream.next();
          if (character !== '"') continue;
          if (stream.peek() === '"') {
            // "" is an escaped quote, not the end of the field.
            stream.next();
            continue;
          }
          state.quoted = false;
          break;
        }
        return "string";
      }

      if (stream.match('"')) {
        state.quoted = true;
        return "string";
      }
      if (stream.match(/^[;,|\t]/)) return "punctuation";
      if (stream.match(/^[^";,|\t]+/)) return null;
      stream.next();
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// LOG
// ---------------------------------------------------------------------------

interface LogHighlighterState {
  /** Nothing is carried between lines yet; the parser is stateless by design. */
  seen: boolean;
}

const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
const LOG_LEVEL = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b/;
const LOG_STACK =
  /^\s+(?:at\s|\.{3}\s|File\s"|Traceback|Caused by|[\w.$]+\([^)]*\)|[\w.$]+Error:|[\w.$]+Exception)/;

function logParser(): StreamParser<LogHighlighterState> {
  return {
    name: "log",
    startState: () => ({ seen: false }),
    copyState: () => ({ seen: true }),
    token(stream: StringStream): string | null {
      if (stream.sol()) {
        // A continuation line belongs to the previous event; dim it so the
        // event boundaries stay visible.
        if (stream.match(LOG_STACK)) {
          stream.skipToEnd();
          return "comment";
        }
        if (stream.match(LOG_TIMESTAMP)) return "number";
      }
      if (stream.match(LOG_LEVEL)) return "keyword";
      if (stream.match(/^\[[^\]]{0,80}\]/)) return "comment";
      if (stream.match(/^\d+(?:[.,]\d+)?(?:ms|s|B|KB|MB|GB|%)?\b/)) return "number";
      stream.next();
      return null;
    },
  };
}
