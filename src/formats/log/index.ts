/**
 * LOG format module.
 *
 * Exposes the parser and the filter helper for tests and other modules, and the
 * `FormatModule` the preview registry consumes.
 */

import type { FormatModule } from "@/documents/types";

import "./styles.css";

import { LogViewer } from "./LogViewer";
import { logOutline } from "./outline";

export const logModule: FormatModule = {
  kind: "log",
  Viewer: LogViewer,
  outline: logOutline,
};

export { parseLog, detectLogProfile, countLogLevels, emptyLevelCounts, LOG_LEVELS } from "./parse";
export type {
  LogDocument,
  LogEvent,
  LogLevel,
  LogLine,
  LogParseOptions,
  LogProfile,
  LogProfileChoice,
} from "./parse";

export { filterLogEvents } from "./filters";
export type { LogFilter, LogFilterResult, LogLevelFilter } from "./filters";

export { logOutline } from "./outline";
export { LogViewer } from "./LogViewer";
