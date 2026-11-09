/**
 * LOG parser.
 *
 * There is no single log standard, so the parser recognises three explicit
 * profiles and always reports which one it used:
 *
 * - `iso`    — a timestamp, a level word and a message, e.g.
 *              `2026-11-09T08:10:00+05:00 INFO [app] Приложение запущено`;
 * - `ndjson` — one JSON object per line (time/level/msg/message/logger/source);
 * - `plain`  — anything else: every non-empty line is kept as an UNKNOWN event.
 *
 * The source text stays the source of truth. An event only points at physical
 * lines and UTF-16 offsets, so the viewer can jump back into the editor without
 * a second mapping. Times are copied verbatim: a timestamp without a zone is
 * never silently shifted to UTC.
 *
 * A level is read from the level field only — an INFO message that happens to
 * contain the word "ERROR" stays INFO. Lines that do not start a new structured
 * event but look like a continuation (an indented stack frame, `at …`,
 * `Caused by:`) belong to the previous event; everything else becomes its own
 * UNKNOWN event, so no physical line is ever dropped.
 *
 * The parser never throws and never touches the DOM.
 */

import { t } from "@/shared/i18n";
import type { Diagnostic, ParseResult } from "@/documents/types";

/** Normalised severity of one event. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

/** Profile actually used to build the model. */
export type LogProfile = "iso" | "ndjson" | "plain";

/** Profile requested by the viewer; `auto` keeps the detected one. */
export type LogProfileChoice = LogProfile | "auto";

/** One physical line of the source. */
export interface LogLine {
  /** 1-based line number. */
  line: number;
  /** Line text without the line terminator. */
  text: string;
}

/** One logical log event, possibly spanning several physical lines. */
export interface LogEvent {
  /** Stable id derived from the first physical line. */
  id: string;
  level: LogLevel;
  /** Level exactly as written in the file, upper-cased; `UNKNOWN` when absent. */
  levelText: string;
  /** Time exactly as written in the file; never converted or timezone-shifted. */
  time: string | null;
  /** Logger / component name, when the profile carries one. */
  source: string | null;
  /** The message itself, without the stack trace. */
  message: string;
  /** Continuation lines (stack trace) belonging to this event. */
  continuation: LogLine[];
  /** 1-based first physical line. */
  line: number;
  /** 1-based last physical line, including the stack trace. */
  endLine: number;
  /** UTF-16 offset of the first character of the event. */
  from: number;
  /** UTF-16 offset just past the last character of the event (no line terminator). */
  to: number;
}

/** Everything the LOG viewer needs, derived from the raw text. */
export interface LogDocument {
  /** Profile used for this model. */
  profile: LogProfile;
  /** Profile auto-detection chose, shown as “Auto (…)”. */
  autoProfile: LogProfile;
  events: LogEvent[];
  /** Physical lines in the source, including blank ones. */
  lineCount: number;
  /** Level totals before any filter. */
  counts: Record<LogLevel, number>;
  /** Distinct sources in order of first appearance. */
  sources: string[];
}

/** Options accepted by {@link parseLog}. */
export interface LogParseOptions {
  /** Explicit profile, or `auto` (default). */
  profile?: LogProfileChoice;
}

/** Every level, in severity order, for filters and counters. */
export const LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "unknown",
];

/** A timestamp at the start of an ISO-style log line. */
const TIMESTAMP_SOURCE = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?`;

/** The level words a structured profile may use. */
const LEVEL_SOURCE = String.raw`TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERR(?:OR)?|FATAL|CRIT(?:ICAL)?|SEVERE`;

/**
 * `timestamp LEVEL message`.
 *
 * The level must be a known word directly after the timestamp: the parser must
 * never read a level out of the message text.
 */
const STRUCTURED_LINE = new RegExp(
  String.raw`^(?<time>${TIMESTAMP_SOURCE})\s+(?:\[(?<bracketLevel>${LEVEL_SOURCE})\]|(?<level>${LEVEL_SOURCE})(?![A-Za-z]))\s*[:|\-]?\s*(?<rest>.*)$`,
  "i",
);

/** `[source] message` after the level. */
const BRACKET_SOURCE = /^\[(?<name>[^\]\n]{1,80})\]\s*(?<message>[\s\S]*)$/;

/** `module.component: message` after the level; the dot keeps prose out. */
const DOTTED_SOURCE = /^(?<name>[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)\s*[:|-]\s+(?<message>[\s\S]*)$/;

/** A line that starts with whitespace or a well-known stack-trace marker. */
const STACK_MARKER =
  /^(?:at\s|Caused by:|Suppressed:|\.\.\.\s*\d+\s+more|Traceback\s*\(|File\s+"|Exception\b|#\d+\s)/;

const LEVEL_BY_WORD: Readonly<Record<string, LogLevel>> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  notice: "info",
  config: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  err: "error",
  severe: "error",
  fatal: "fatal",
  critical: "fatal",
  crit: "fatal",
};

const TIME_KEYS = ["time", "ts", "timestamp", "@timestamp", "datetime", "date"] as const;
const LEVEL_KEYS = ["level", "severity", "lvl", "@level", "loglevel", "log_level"] as const;
const MESSAGE_KEYS = ["msg", "message", "text", "event", "error"] as const;
const SOURCE_KEYS = ["logger", "source", "name", "module", "category", "component"] as const;
const STACK_KEYS = ["stack", "stacktrace", "stack_trace", "trace", "exception"] as const;

const JSON_LOG_KEYS: readonly string[] = [...TIME_KEYS, ...LEVEL_KEYS, ...MESSAGE_KEYS];

interface PhysicalLine {
  /** 1-based. */
  line: number;
  text: string;
  from: number;
  to: number;
}

interface DraftEvent {
  level: LogLevel;
  levelText: string;
  time: string | null;
  source: string | null;
  message: string;
  continuation: LogLine[];
  first: PhysicalLine;
  last: PhysicalLine;
}

/** Counters initialised to zero for every level. */
export function emptyLevelCounts(): Record<LogLevel, number> {
  return { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, unknown: 0 };
}

/** Level totals for a list of events. */
export function countLogLevels(events: readonly LogEvent[]): Record<LogLevel, number> {
  const counts = emptyLevelCounts();
  for (const event of events) counts[event.level] += 1;
  return counts;
}

/** Profile that best matches the source, without building a model. */
export function detectLogProfile(source: string): LogProfile {
  return detectFromLines(splitLines(source));
}

/**
 * Parse a log file.
 *
 * Always returns a model for a readable text file — an empty file is a valid
 * document with zero events. The only `model: null` case is an unexpected
 * parser failure, which is reported as a diagnostic instead of an exception.
 */
export function parseLog(source: string, options: LogParseOptions = {}): ParseResult<LogDocument> {
  try {
    const lines = splitLines(source);
    const autoProfile = detectFromLines(lines);
    const requested = options.profile ?? "auto";
    const profile: LogProfile = requested === "auto" ? autoProfile : requested;

    const events =
      profile === "iso"
        ? parseIsoLines(lines)
        : profile === "ndjson"
          ? parseNdjsonLines(lines)
          : parsePlainLines(lines);

    return {
      model: {
        profile,
        autoProfile,
        events,
        lineCount: lines.length,
        counts: countLogLevels(events),
        sources: collectSources(events),
      },
      diagnostics: [],
    };
  } catch {
    const diagnostic: Diagnostic = {
      severity: "error",
      message: t("viewer.invalid"),
      from: 0,
      to: 0,
      line: 1,
      column: 1,
    };
    return { model: null, diagnostics: [diagnostic] };
  }
}

/** Split on LF, CRLF and lone CR, keeping offsets and 1-based numbers. */
function splitLines(source: string): PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let lineNumber = 1;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code !== 10 && code !== 13) continue;

    lines.push({
      line: lineNumber,
      text: stripBom(source.slice(start, index), lineNumber),
      from: start,
      to: index,
    });
    if (code === 13 && source.charCodeAt(index + 1) === 10) index += 1;
    start = index + 1;
    lineNumber += 1;
  }

  // A trailing line terminator ends the last line instead of starting a new one.
  if (start < source.length) {
    lines.push({
      line: lineNumber,
      text: stripBom(source.slice(start), lineNumber),
      from: start,
      to: source.length,
    });
  }

  return lines;
}

function stripBom(text: string, line: number): string {
  return line === 1 && text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function detectFromLines(lines: readonly PhysicalLine[]): LogProfile {
  let anchors = 0;
  let iso = 0;
  let json = 0;
  let jsonWithFields = 0;

  for (const line of lines) {
    if (!line.text.trim()) continue;

    if (STRUCTURED_LINE.test(line.text)) {
      iso += 1;
      anchors += 1;
      continue;
    }

    const record = tryParseJsonObject(line.text);
    if (record) {
      json += 1;
      anchors += 1;
      if (hasLogFields(record)) jsonWithFields += 1;
      continue;
    }

    if (!isContinuation(line.text)) anchors += 1;
  }

  if (anchors === 0) return "plain";
  if (json > 0 && jsonWithFields > 0 && json / anchors >= 0.5) return "ndjson";
  if (iso > 0 && iso / anchors >= 0.5) return "iso";
  return "plain";
}

function hasLogFields(record: Record<string, unknown>): boolean {
  return JSON_LOG_KEYS.some((key) => record[key] !== undefined && record[key] !== null);
}

function parseIsoLines(lines: readonly PhysicalLine[]): LogEvent[] {
  const events: LogEvent[] = [];
  let current: DraftEvent | null = null;

  for (const line of lines) {
    if (!line.text.trim()) continue;

    const match = STRUCTURED_LINE.exec(line.text);
    if (match?.groups) {
      if (current) events.push(toEvent(current));
      current = structuredDraft(match.groups, line);
      continue;
    }

    if (isContinuation(line.text) && current) {
      current.continuation.push({ text: line.text, line: line.line });
      current.last = line;
      continue;
    }

    if (current) events.push(toEvent(current));
    current = unknownDraft(line);
  }

  if (current) events.push(toEvent(current));
  return events;
}

function parseNdjsonLines(lines: readonly PhysicalLine[]): LogEvent[] {
  const events: LogEvent[] = [];
  let current: DraftEvent | null = null;

  for (const line of lines) {
    if (!line.text.trim()) continue;

    const record = tryParseJsonObject(line.text);
    if (record) {
      if (current) events.push(toEvent(current));
      current = ndjsonDraft(record, line);
      continue;
    }

    if (isContinuation(line.text) && current) {
      current.continuation.push({ text: line.text, line: line.line });
      current.last = line;
      continue;
    }

    if (current) events.push(toEvent(current));
    current = unknownDraft(line);
  }

  if (current) events.push(toEvent(current));
  return events;
}

function parsePlainLines(lines: readonly PhysicalLine[]): LogEvent[] {
  const events: LogEvent[] = [];
  for (const line of lines) {
    if (!line.text.trim()) continue;
    events.push(toEvent(unknownDraft(line)));
  }
  return events;
}

function structuredDraft(groups: Record<string, string>, line: PhysicalLine): DraftEvent {
  const time = groups.time ?? "";
  const levelToken = (groups.bracketLevel ?? groups.level ?? "").trim();
  const { source, message } = splitSource(groups.rest ?? "");

  return {
    level: parseLevelToken(levelToken),
    levelText: levelToken.length > 0 ? levelToken.toUpperCase() : "UNKNOWN",
    time: time.length > 0 ? time : null,
    source,
    message,
    continuation: [],
    first: line,
    last: line,
  };
}

function ndjsonDraft(record: Record<string, unknown>, line: PhysicalLine): DraftEvent {
  const levelToken = pickString(record, LEVEL_KEYS);
  const message = pickString(record, MESSAGE_KEYS);
  const stack = pickString(record, STACK_KEYS);

  return {
    level: levelToken === null ? "unknown" : parseLevelToken(levelToken),
    levelText:
      levelToken === null || levelToken.trim().length === 0 ? "UNKNOWN" : levelToken.trim().toUpperCase(),
    time: pickString(record, TIME_KEYS),
    source: pickString(record, SOURCE_KEYS),
    message: message === null ? "" : message.trim(),
    continuation: stack === null ? [] : stackLines(stack, line),
    first: line,
    last: line,
  };
}

/** Split a JSON `stack` value into continuation lines, all on the same physical line. */
function stackLines(stack: string, line: PhysicalLine): LogLine[] {
  const result: LogLine[] = [];
  for (const text of stack.split(/\r\n|\r|\n/)) {
    if (!text.trim()) continue;
    result.push({ text: text.trimEnd(), line: line.line });
  }
  return result;
}

function unknownDraft(line: PhysicalLine): DraftEvent {
  return {
    level: "unknown",
    levelText: "UNKNOWN",
    time: null,
    source: null,
    message: line.text.trim(),
    continuation: [],
    first: line,
    last: line,
  };
}

function toEvent(draft: DraftEvent): LogEvent {
  return {
    id: `log-event-${draft.first.line}`,
    level: draft.level,
    levelText: draft.levelText,
    time: draft.time,
    source: draft.source,
    message: draft.message,
    continuation: draft.continuation,
    line: draft.first.line,
    endLine: draft.last.line,
    from: draft.first.from,
    to: draft.last.to,
  };
}

function parseLevelToken(token: string): LogLevel {
  return LEVEL_BY_WORD[token.trim().toLowerCase()] ?? "unknown";
}

/** Split the text after the level into an optional source and the message. */
function splitSource(rest: string): { source: string | null; message: string } {
  const text = rest.trimStart();
  if (!text) return { source: null, message: "" };

  const bracketed = BRACKET_SOURCE.exec(text);
  if (bracketed?.groups) {
    return { source: bracketed.groups.name.trim() || null, message: bracketed.groups.message.trim() };
  }

  const dotted = DOTTED_SOURCE.exec(text);
  if (dotted?.groups) {
    return { source: dotted.groups.name.trim(), message: dotted.groups.message.trim() };
  }

  return { source: null, message: text.trim() };
}

/** A continuation line never starts a new event on its own. */
function isContinuation(text: string): boolean {
  if (text.length === 0) return false;
  const first = text.charCodeAt(0);
  if (first === 32 || first === 9) return true;
  return STACK_MARKER.test(text);
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      return value.map((item) => (typeof item === "string" ? item : stringifyValue(item))).join("\n");
    }
    return stringifyValue(value);
  }
  return null;
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function collectSources(events: readonly LogEvent[]): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const event of events) {
    const source = event.source;
    if (source === null || source.length === 0 || seen.has(source)) continue;
    seen.add(source);
    sources.push(source);
  }
  return sources;
}
