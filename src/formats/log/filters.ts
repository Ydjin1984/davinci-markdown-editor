/**
 * Event filtering for the LOG viewer.
 *
 * Filtering is a pure operation on the parsed model: the document itself is
 * never touched, and the counters report both sides of the filter so the UI can
 * say “showing N of M”.
 */

import type { LogEvent, LogLevel } from "./parse";

/** Level filter: one level, or every level. */
export type LogLevelFilter = LogLevel | "all";

/** Everything the LOG viewer can filter by. */
export interface LogFilter {
  /** Case-insensitive substring of the time, source, message or stack lines. */
  text?: string;
  level?: LogLevelFilter;
  /** Exact source name; `null` shows every source. */
  source?: string | null;
}

/** Filtered events plus the counters shown above the list. */
export interface LogFilterResult {
  events: LogEvent[];
  /** Events before the filter. */
  total: number;
  /** Events after the filter. */
  shown: number;
}

/**
 * Apply `filter` to `events`.
 *
 * The text search deliberately ignores the level: searching for "ERROR" finds
 * the messages that mention it, not every ERROR event. The level has its own
 * control, so a level is never inferred from message text.
 */
export function filterLogEvents(events: readonly LogEvent[], filter: LogFilter = {}): LogFilterResult {
  const needle = (filter.text ?? "").trim().toLowerCase();
  const level = filter.level ?? "all";
  const source = filter.source ?? null;

  const matched = events.filter((event) => {
    if (level !== "all" && event.level !== level) return false;
    if (source !== null && (event.source ?? "") !== source) return false;
    if (!needle) return true;
    return eventText(event).includes(needle);
  });

  return { events: matched, total: events.length, shown: matched.length };
}

function eventText(event: LogEvent): string {
  const parts = [event.time ?? "", event.source ?? "", event.message];
  for (const line of event.continuation) parts.push(line.text);
  return parts.join("\n").toLowerCase();
}
