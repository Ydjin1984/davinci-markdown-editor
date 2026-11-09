/**
 * Format module registry.
 *
 * One import per structured format; the preview asks for a module by document
 * kind and falls back to the source view when there is none (Markdown and plain
 * text have no module: Markdown has its own pipeline and text has nothing to
 * structure).
 */

import type { DocumentKind, FormatModule } from "@/documents/types";
import { csvModule } from "./csv";
import { jsonModule } from "./json";
import { logModule } from "./log";
import { xmlModule } from "./xml";

const MODULES: Partial<Record<DocumentKind, FormatModule>> = {
  json: jsonModule,
  csv: csvModule,
  log: logModule,
  xml: xmlModule,
};

/** Module for a kind, or `undefined` when the kind has no structured view. */
export function formatModule(kind: DocumentKind): FormatModule | undefined {
  return MODULES[kind];
}
