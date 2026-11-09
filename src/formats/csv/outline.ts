/**
 * Outline for CSV documents: one entry per column.
 *
 * The outline panel shows the column order; the header text is kept exactly as
 * written, and a column without a header falls back to its position.
 */

import type { OutlineItem } from "@/shared/types";

import { parseCsv } from "./parse";

export function csvOutline(source: string): OutlineItem[] {
  const { model } = parseCsv(source);
  if (!model) return [];

  return model.columns.map((column) => ({
    id: `csv-${column.id}`,
    text: column.label || `#${column.index}`,
    level: 1,
    line: 1,
    children: [],
  }));
}
