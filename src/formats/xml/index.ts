/**
 * XML format module.
 *
 * One import site for the whole format: the parser, the tree viewer, the
 * outline and the stylesheet. The application registry only needs the
 * `FormatModule` object; tests import `parseXml` and `xmlOutline` directly.
 */

import type { FormatModule } from "@/documents/types";
import { xmlOutline } from "./outline";
import { XmlViewer } from "./XmlViewer";
import "./styles.css";

export { parseXml } from "./parse";
export type { XmlAttribute, XmlDocument, XmlNamespaceDeclaration, XmlNode, XmlNodeKind } from "./parse";
export { xmlOutline } from "./outline";
export { XmlViewer } from "./XmlViewer";

/** The XML contribution to the preview: a lossless tree plus the element outline. */
export const xmlModule: FormatModule = {
  kind: "xml",
  Viewer: XmlViewer,
  outline: xmlOutline,
};
