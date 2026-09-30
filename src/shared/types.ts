/**
 * TypeScript mirrors of the Rust structures crossing the IPC boundary.
 *
 * These are hand-written rather than generated so the contract is explicit and
 * reviewable. Every field name matches the `camelCase` serialisation the Rust
 * side produces.
 */

export type Eol = "lf" | "crlf";

export type LayoutMode = "editor" | "preview" | "split-h" | "split-v";

export type ThemeMode = "system" | "light" | "dark";

export type MermaidTheme = "auto" | "default" | "dark" | "forest" | "neutral" | "base";

export type ExternalChangePolicy = "ask" | "autoReload" | "keepLocal";

export type DefaultEolPolicy = "preserve" | "lf" | "crlf";

export type FileFilterKind = "markdown" | "svg" | "html" | "any";

export type DialogKind = "info" | "warning" | "error";

export type DialogButtons = "ok" | "okCancel";

/** Stable error taxonomy produced by `AppError` in Rust. */
export type ErrorCode =
  | "notFound"
  | "permissionDenied"
  | "isADirectory"
  | "notADirectory"
  | "invalidPath"
  | "alreadyExists"
  | "notEmpty"
  | "encoding"
  | "tooLarge"
  | "unsupported"
  | "busy"
  | "conflict"
  | "watch"
  | "io"
  | "internal";

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;
  detail?: string;
  path?: string;
}

export interface TextDocument {
  path: string;
  name: string;
  dir: string;
  content: string;
  encoding: string;
  eol: Eol;
  bom: boolean;
  size: number;
  modifiedMs: number;
  readOnly: boolean;
  hash: string;
  lineCount: number;
}

export interface WriteOptions {
  encoding?: string | null;
  eol?: Eol | null;
  bom?: boolean | null;
  /** SHA-256 of the loaded content; a mismatch makes the write fail with `conflict`. */
  expectedHash?: string | null;
}

export interface ExternalFileState {
  path: string;
  exists: boolean;
  size: number;
  modifiedMs: number;
  hash: string;
}

export interface PathInfo {
  path: string;
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  isMarkdown: boolean;
  readOnly: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  isMarkdown: boolean;
  extension: string | null;
  size: number;
  modifiedMs: number;
  hasChildren: boolean;
}

export interface ListOptions {
  includeIgnored: boolean;
  extraIgnored: string[];
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: number;
}

export interface AutosaveSettings {
  enabled: boolean;
  delayMs: number;
  onFocusLost: boolean;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  highlightActiveLine: boolean;
  bracketMatching: boolean;
  codeFolding: boolean;
  showWhitespace: boolean;
  autosave: AutosaveSettings;
}

export interface PreviewSettings {
  theme: ThemeMode;
  fontSize: number;
  syncScroll: boolean;
  mermaidTheme: MermaidTheme;
  codeTheme: string;
  allowRawHtml: boolean;
  renderMath: boolean;
  lineWrapCode: boolean;
  openExternalLinks: boolean;
  headingAnchors: boolean;
}

export interface FilesSettings {
  restoreSession: boolean;
  recentFiles: RecentEntry[];
  recentWorkspaces: string[];
  externalChange: ExternalChangePolicy;
  defaultEol: DefaultEolPolicy;
  defaultEncoding: string;
  showIgnored: boolean;
  extraIgnored: string[];
  confirmDelete: boolean;
}

export interface ApplicationSettings {
  theme: ThemeMode;
  zoom: number;
  language: string;
  telemetry: boolean;
}

export interface ViewSettings {
  layout: LayoutMode;
  splitRatio: number;
  showExplorer: boolean;
  showOutline: boolean;
  explorerWidth: number;
  outlineWidth: number;
}

export interface Settings {
  editor: EditorSettings;
  preview: PreviewSettings;
  files: FilesSettings;
  application: ApplicationSettings;
  view: ViewSettings;
}

export interface SessionDocument {
  path: string;
  cursorLine: number;
  cursorCol: number;
  scrollTop: number;
}

export interface Session {
  documents: SessionDocument[];
  activeIndex: number;
  workspaceRoot: string | null;
}

export interface LaunchPayload {
  files: string[];
  workspace: string | null;
}

export type FsChangeKind = "created" | "modified" | "removed" | "renamed";

export interface FsChange {
  path: string;
  kind: FsChangeKind;
  to?: string;
}

export interface FsChangedPayload {
  changes: FsChange[];
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  configDir: string;
  assetScheme: string;
  assetRoots: string[];
  watchedPaths: string[];
}

/** Outline entry derived from the document's heading structure. */
export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  line: number;
  children: OutlineItem[];
}

/** A rendered Markdown block, kept alongside its source position for scroll sync. */
export interface RenderedDocument {
  html: string;
  outline: OutlineItem[];
  /** Diagram sources found in the document, in document order. */
  diagrams: string[];
}
