/**
 * Outline entries for the Outline panel.
 *
 * JSON has no headings, so the outline is the document structure itself: root
 * keys (or array indices) with their nested containers. An unparsable document
 * has no structure to show, and the entry list is bounded so a large file can
 * never make the panel expensive.
 */

import type { OutlineItem } from "@/shared/types";

import { buildLineIndex, lineColumnAt, parseJson, type JsonNode } from "./parse";

/** Most outline entries collected from one document. */
export const MAX_OUTLINE_ITEMS = 200;

/** Deepest nesting expanded into the outline. */
export const MAX_OUTLINE_DEPTH = 3;

/** Structure of a parsed JSON document, capped for the Outline panel. */
export function jsonOutline(source: string): OutlineItem[] {
  const result = parseJson(source);
  if (result.model === null) return [];

  const lineStarts = buildLineIndex(source);
  const lineOf = (offset: number): number => lineColumnAt(lineStarts, offset).line;
  const budget = { left: MAX_OUTLINE_ITEMS };

  const childrenOf = (node: JsonNode, level: number, path: string): OutlineItem[] => {
    if (budget.left <= 0 || level > MAX_OUTLINE_DEPTH) return [];
    if (node.kind !== "object" && node.kind !== "array") return [];

    const items: OutlineItem[] = [];
    if (node.kind === "object") {
      for (let index = 0; index < node.entries.length; index += 1) {
        if (budget.left <= 0) break;
        const entry = node.entries[index];
        budget.left -= 1;
        const id = `${path}/${index}`;
        items.push({
          id: `json:${id}`,
          text: entry.key,
          level,
          line: lineOf(entry.keyFrom),
          children: childrenOf(entry.value, level + 1, id),
        });
      }
    } else {
      for (let index = 0; index < node.items.length; index += 1) {
        if (budget.left <= 0) break;
        const item = node.items[index];
        budget.left -= 1;
        const id = `${path}/${index}`;
        items.push({
          id: `json:${id}`,
          text: `[${index}]`,
          level,
          line: lineOf(item.from),
          children: childrenOf(item, level + 1, id),
        });
      }
    }
    return items;
  };

  return childrenOf(result.model.node, 1, "");
}
