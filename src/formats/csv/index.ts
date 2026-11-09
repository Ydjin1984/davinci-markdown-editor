/**
 * CSV format module: parser, table viewer and outline behind one contract.
 */

import type { FormatModule } from "@/documents/types";

import { CsvViewer } from "./CsvViewer";
import { csvOutline } from "./outline";

import "./styles.css";

export { CsvViewer } from "./CsvViewer";
export { csvOutline } from "./outline";
export { CSV_DELIMITERS, detectDelimiter, isCsvDelimiter, parseCsv } from "./parse";
export type {
  CsvColumn,
  CsvDelimiter,
  CsvDialect,
  CsvParseOptions,
  CsvRecord,
  CsvTable,
  CsvWidthIssue,
} from "./parse";
export { cellAt, computeWindow, filterRecords, sortRecords, viewRecords } from "./table";
export type { CsvSort, CsvWindow } from "./table";

export const csvModule: FormatModule = {
  kind: "csv",
  Viewer: CsvViewer,
  outline: csvOutline,
};
