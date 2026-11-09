/**
 * Shared viewer chrome.
 *
 * A format module imports `ViewerShell`, `SourceView` and `useParsed` from here
 * so every structured view behaves the same way.
 */

import "./viewer.css";

export { ViewerShell, ViewerMessage, useParsed } from "./ViewerShell";
export type { ViewerModeOption, ViewerShellProps, ViewerMessageProps } from "./ViewerShell";
export { SourceView } from "./SourceView";
