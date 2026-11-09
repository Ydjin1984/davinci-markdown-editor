/**
 * Document kinds and the contract every format module implements.
 *
 * The raw source text stays the single source of truth: a format module only
 * derives a view from it. Nothing here can rewrite the document, and a viewer
 * only ever reads `content`.
 */

import type { ComponentType } from "react";

import type { StringKey } from "@/shared/i18n";
import type { DocumentKind, FileFilterKind, OutlineItem } from "@/shared/types";

export type { DocumentKind };

/** CodeMirror grammar used for the source pane. */
export type EditorLanguage = "markdown" | "json" | "csv" | "log" | "xml" | "text";

/** Structured representations a format can offer. */
export type PreviewMode = "rendered" | "tree" | "table" | "events" | "source";

/**
 * One problem found while parsing.
 *
 * `from`/`to` are UTF-16 offsets, exactly as CodeMirror counts them, so a
 * diagnostic can select the same text in the editor without a second mapping.
 */
export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  from: number;
  to: number;
  /** 1-based line, as every editor in the world reports it. */
  line: number;
  /** 1-based column. */
  column: number;
}

/** A parser result: a model when one could be built, plus everything it noticed. */
export interface ParseResult<Model> {
  /** `null` when the input could not be modelled at all. */
  model: Model | null;
  diagnostics: Diagnostic[];
}

/** Stable identity of one parse, used to discard stale async work. */
export interface ParseRequest {
  documentId: string;
  revision: number;
  kind: DocumentKind;
  source: string;
  options: Record<string, unknown>;
}

/** How a document kind is described to the rest of the application. */
export interface DocumentTypeDescriptor {
  kind: DocumentKind;
  /** i18n key for the human-readable name. */
  labelKey: StringKey;
  /** Lower-case extensions without the dot. */
  extensions: string[];
  mime: string;
  editorLanguage: EditorLanguage;
  /** Modes the preview can show; the first one a format cannot structure is `source`. */
  modes: PreviewMode[];
  defaultMode: PreviewMode;
  /** Dialog filter used by Save As for this kind. */
  filter: FileFilterKind;
}

/** Props handed to every structured viewer. */
export interface ViewerProps {
  /** Raw source; the viewer never writes back to it. */
  content: string;
  documentId: string;
  /** Changes whenever `content` is replaced from outside the editor. */
  revision: number;
  appearance: "light" | "dark";
  /** Move the caret in the editor to a 1-based line, optionally a column. */
  onJumpToLine: (line: number, column?: number) => void;
  /**
   * Replace the editor buffer as one undoable edit.
   *
   * Only an explicit user command may call this (JSON "Format"/"Minify"); a
   * viewer never rewrites the document on its own.
   */
  onReplaceContent?: (text: string) => void;
}

export type ViewerComponent = ComponentType<ViewerProps>;

/** Everything a format contributes to the preview and the outline. */
export interface FormatModule {
  kind: DocumentKind;
  Viewer: ViewerComponent;
  /** Structure shown in the Outline panel, if the format has one. */
  outline?: (content: string) => OutlineItem[];
}
