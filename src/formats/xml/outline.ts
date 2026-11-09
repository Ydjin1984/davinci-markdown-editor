/**
 * Outline for XML documents.
 *
 * The panel shows the element structure only: text, comments and processing
 * instructions are content, not navigation targets. Repeated element names stay
 * separate entries because they are separate nodes, not keys in an object.
 */

import type { OutlineItem } from "@/shared/types";
import { parseXml, type XmlNode } from "./parse";

function itemOf(node: XmlNode, level: number): OutlineItem {
  return {
    id: `xml-${node.from}`,
    text: node.name,
    level,
    line: node.line,
    children: node.children
      .filter((child) => child.kind === "element")
      .map((child) => itemOf(child, level + 1)),
  };
}

/** Element structure of a document; an unparseable document has no outline. */
export function xmlOutline(source: string): OutlineItem[] {
  const { model } = parseXml(source);
  if (model === null) return [];
  return model.nodes.filter((node) => node.kind === "element").map((node) => itemOf(node, 1));
}
