/**
 * Presentation helpers for the CSV table.
 *
 * Filtering and sorting are view-only: they return new arrays and never touch
 * the model produced by the parser, so saving the document can never reorder
 * its bytes. Windowing keeps a 100 000-row file down to the rows that are
 * actually on screen.
 */

import type { CsvRecord } from "./parse";

/** Column a sort is applied to, and in which direction. */
export interface CsvSort {
  /** 1-based column position. */
  column: number;
  direction: "asc" | "desc";
}

/** Value of a column in a record; short records read as empty cells. */
export function cellAt(record: CsvRecord, column: number): string {
  return record.cells[column - 1] ?? "";
}

/** Records whose cells contain `query`, case-insensitively. */
export function filterRecords(records: readonly CsvRecord[], query: string): CsvRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return records.slice();
  return records.filter((record) => record.cells.some((cell) => cell.toLowerCase().includes(needle)));
}

/**
 * Sort a copy of the records by one column.
 *
 * Comparison is plain code-unit order rather than numeric, so `000123` sorts
 * as the text it is. Ties keep the original record order.
 */
export function sortRecords(records: readonly CsvRecord[], sort: CsvSort | null): CsvRecord[] {
  const copy = records.slice();
  if (!sort) return copy;
  const factor = sort.direction === "asc" ? 1 : -1;
  copy.sort((left, right) => {
    const a = cellAt(left, sort.column);
    const b = cellAt(right, sort.column);
    const compared = a < b ? -1 : a > b ? 1 : 0;
    return compared === 0 ? left.index - right.index : compared * factor;
  });
  return copy;
}

/** Filter first, then sort — the order the table shows. */
export function viewRecords(records: readonly CsvRecord[], query: string, sort: CsvSort | null): CsvRecord[] {
  return sortRecords(filterRecords(records, query), sort);
}

/** Visible slice of a virtualized list. */
export interface CsvWindow {
  /** Index of the first rendered row. */
  first: number;
  /** Index past the last rendered row. */
  last: number;
  /** Pixel offset of the first rendered row inside the scroll area. */
  offset: number;
  /** Height of the rendered slice. */
  height: number;
  /** Height of the full list. */
  totalHeight: number;
}

/**
 * Compute the rendered window for a fixed-row-height list.
 *
 * Callers render `last - first` rows, never the whole list: a 100 000-row
 * document has the same node count as a 40-row one.
 */
export function computeWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): CsvWindow {
  if (total <= 0 || rowHeight <= 0) {
    return { first: 0, last: 0, offset: 0, height: 0, totalHeight: 0 };
  }
  const totalHeight = total * rowHeight;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2 + 1;
  const last = Math.min(total, first + visible);
  return {
    first,
    last,
    offset: first * rowHeight,
    height: (last - first) * rowHeight,
    totalHeight,
  };
}
