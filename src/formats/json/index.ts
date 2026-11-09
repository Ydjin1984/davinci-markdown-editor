/**
 * JSON format module.
 *
 * Collected by `src/formats/index.ts` (owned by the Lead). Everything a caller
 * needs comes from here: the parser, the viewer, the outline builder and the
 * `FormatModule` value the registry expects.
 */

import type { FormatModule } from "@/documents/types";

import { JsonViewer } from "./JsonViewer";
import { jsonOutline } from "./outline";

import "./styles.css";

export { JsonViewer } from "./JsonViewer";
export { jsonOutline } from "./outline";
export {
  buildLineIndex,
  formatJson,
  lineColumnAt,
  MAX_DEPTH,
  MAX_NODES,
  minifyJson,
  minifyNode,
  parseJson,
} from "./parse";
export type {
  JsonArrayNode,
  JsonBooleanNode,
  JsonNode,
  JsonNullNode,
  JsonNumberNode,
  JsonObjectEntry,
  JsonObjectNode,
  JsonRoot,
  JsonStringNode,
  JsonTruncatedNode,
} from "./parse";
export { escapePointerSegment, jsonPointer } from "./pointer";
export type { JsonPointerSegment } from "./pointer";

export const jsonModule: FormatModule = {
  kind: "json",
  Viewer: JsonViewer,
  outline: jsonOutline,
};
