/**
 * Registry of document formats.
 *
 * One table describes every format the editor can open: the extensions it
 * claims, the CodeMirror grammar, the preview modes it offers and the Save As
 * filter it uses. Anything that needs to know "what is this file" asks here
 * instead of repeating an extension list.
 */

import { extensionOf } from "@/shared/util";
import type { DocumentKind, DocumentTypeDescriptor } from "./types";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkdn", "mkd", "mdx", "mdtxt", "mdtext"];

export const DOCUMENT_TYPES: readonly DocumentTypeDescriptor[] = [
  {
    kind: "markdown",
    labelKey: "documents.kind.markdown",
    extensions: MARKDOWN_EXTENSIONS,
    mime: "text/markdown",
    editorLanguage: "markdown",
    modes: ["rendered", "source"],
    defaultMode: "rendered",
    filter: "markdown",
  },
  {
    kind: "json",
    labelKey: "documents.kind.json",
    extensions: ["json", "jsonc", "geojson", "webmanifest"],
    mime: "application/json",
    editorLanguage: "json",
    modes: ["tree", "source"],
    defaultMode: "tree",
    filter: "json",
  },
  {
    kind: "csv",
    labelKey: "documents.kind.csv",
    extensions: ["csv", "tsv"],
    mime: "text/csv",
    editorLanguage: "csv",
    modes: ["table", "source"],
    defaultMode: "table",
    filter: "csv",
  },
  {
    kind: "log",
    labelKey: "documents.kind.log",
    extensions: ["log", "ndjson"],
    mime: "text/plain",
    editorLanguage: "log",
    modes: ["events", "source"],
    defaultMode: "events",
    filter: "log",
  },
  {
    kind: "xml",
    labelKey: "documents.kind.xml",
    extensions: ["xml", "xsd", "xsl", "xslt", "svg", "rss", "atom", "plist"],
    mime: "application/xml",
    editorLanguage: "xml",
    modes: ["tree", "source"],
    defaultMode: "tree",
    filter: "xml",
  },
  {
    kind: "text",
    labelKey: "documents.kind.text",
    extensions: ["txt", "text", "ini", "cfg", "conf", "yaml", "yml", "toml"],
    mime: "text/plain",
    editorLanguage: "text",
    modes: ["source"],
    defaultMode: "source",
    filter: "text",
  },
];

export const TEXT_DESCRIPTOR: DocumentTypeDescriptor = DOCUMENT_TYPES.at(-1)!;

const BY_KIND = new Map<DocumentKind, DocumentTypeDescriptor>(
  DOCUMENT_TYPES.map((descriptor) => [descriptor.kind, descriptor]),
);

const BY_EXTENSION = new Map<string, DocumentTypeDescriptor>();
for (const descriptor of DOCUMENT_TYPES) {
  for (const extension of descriptor.extensions) {
    // First declaration wins, so a duplicated extension is a registry bug
    // rather than a silently changing answer.
    if (!BY_EXTENSION.has(extension)) BY_EXTENSION.set(extension, descriptor);
  }
}

/** Descriptor for a known kind; unknown kinds degrade to plain text. */
export function descriptorFor(kind: DocumentKind): DocumentTypeDescriptor {
  return BY_KIND.get(kind) ?? TEXT_DESCRIPTOR;
}

/** Descriptor for a file extension (without the dot, any case), if claimed. */
export function descriptorForExtension(extension: string): DocumentTypeDescriptor | null {
  return BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

/**
 * Kind of a file path.
 *
 * Unknown extensions are plain text rather than an error: opening a file the
 * editor does not understand should still let the user read it.
 */
export function kindFromPath(path: string): DocumentKind {
  return descriptorForExtension(extensionOf(path))?.kind ?? "text";
}

/** True when the extension belongs to a format with a structured viewer. */
export function isStructuredPath(path: string): boolean {
  const descriptor = descriptorForExtension(extensionOf(path));
  return descriptor !== null && descriptor.kind !== "text" && descriptor.kind !== "markdown";
}

/** Every extension the editor claims, for pickers and documentation. */
export function supportedExtensions(): string[] {
  return [...BY_EXTENSION.keys()];
}

/** Extensions grouped as one filter string for dialog helpers. */
export function extensionsFor(kind: DocumentKind): string[] {
  return [...descriptorFor(kind).extensions];
}

/** Markdown-only list kept for compatibility with existing call sites. */
export const MARKDOWN_EXTENSIONS_LIST: readonly string[] = MARKDOWN_EXTENSIONS;

/** True for Markdown paths; other formats have their own answer. */
export function isMarkdownPath(path: string): boolean {
  return descriptorForExtension(extensionOf(path))?.kind === "markdown";
}
