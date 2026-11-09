/**
 * LOG viewer.
 *
 * Events are shown as a fixed-height table so a 10 MiB log stays cheap: only
 * the rows inside the scroll window are mounted. Every physical line is still
 * reachable — clicking an event or a stack frame moves the editor caret to that
 * line, and the source mode of the shared shell shows the file untouched.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from "react";

import type { ViewerProps } from "@/documents/types";
import { SourceView, ViewerMessage, ViewerShell, useParsed } from "@/formats/shared";
import { t, type StringKey } from "@/shared/i18n";
import { cx } from "@/shared/util";

import { filterLogEvents, type LogLevelFilter } from "./filters";
import {
  LOG_LEVELS,
  parseLog,
  type LogEvent,
  type LogLevel,
  type LogProfile,
  type LogProfileChoice,
} from "./parse";

/** Fixed row height of a collapsed event, in CSS pixels. */
const ROW_HEIGHT = 24;
/** Height of one stack-trace line. */
const STACK_LINE_HEIGHT = 18;
/** Paddings around an expanded stack trace. */
const STACK_PADDING = 6;
/** Rows rendered beyond the viewport to keep scrolling smooth. */
const OVERSCAN = 8;
const DEFAULT_VIEWPORT_HEIGHT = 600;

const PROFILE_LABEL: Readonly<Record<LogProfile, StringKey>> = {
  iso: "viewer.log.profile.iso",
  ndjson: "viewer.log.profile.ndjson",
  plain: "viewer.log.profile.plain",
};

type ViewerMode = "events" | "source";

export function LogViewer({ content, onJumpToLine }: ViewerProps) {
  const [mode, setMode] = useState<ViewerMode>("events");
  const [profileChoice, setProfileChoice] = useState<LogProfileChoice>("auto");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const [source, setSource] = useState<string>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);

  const parse = useCallback((text: string) => parseLog(text, { profile: profileChoice }), [profileChoice]);
  const { result, stale } = useParsed(content, parse);
  const model = result.model;

  const filtered = useMemo(
    () =>
      filterLogEvents(model?.events ?? [], { text: query, level, source: source === "all" ? null : source }),
    [model, query, level, source],
  );

  // Exact offsets keep the scroll bar proportional: a collapsed event is one
  // row, an expanded one is its stack trace.
  const metrics = useMemo(() => {
    const events = filtered.events;
    const offsets = new Array<number>(events.length);
    const heights = new Array<number>(events.length);
    let total = 0;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const stackHeight = expanded.has(event.id)
        ? event.continuation.length * STACK_LINE_HEIGHT + STACK_PADDING
        : 0;
      offsets[index] = total;
      heights[index] = ROW_HEIGHT + stackHeight;
      total += ROW_HEIGHT + stackHeight;
    }

    return { offsets, heights, total };
  }, [filtered.events, expanded]);

  const first = useMemo(
    () => lowerBound(metrics.offsets, Math.max(0, scrollTop - OVERSCAN * ROW_HEIGHT)),
    [metrics.offsets, scrollTop],
  );

  const last = useMemo(() => {
    const bottom = scrollTop + viewportHeight + OVERSCAN * ROW_HEIGHT;
    let index = first;
    while (index < metrics.offsets.length && metrics.offsets[index] < bottom) index += 1;
    return index;
  }, [first, metrics.offsets, scrollTop, viewportHeight]);

  // A callback ref keeps the observer attached to the list across mode switches.
  const setScrollElement = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    scrollRef.current = element;
    if (!element) return;

    setViewportHeight(element.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setViewportHeight(element.clientHeight || DEFAULT_VIEWPORT_HEIGHT),
    );
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  // Keep the scroll position valid when a filter shrinks the list.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    if (element.scrollTop > maxScroll) {
      element.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  }, [metrics.total]);

  const resetScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
    setScrollTop(0);
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const toggleStack = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const changeProfile = useCallback(
    (value: string) => {
      setProfileChoice(value === "iso" || value === "ndjson" || value === "plain" ? value : "auto");
      setSource("all");
      resetScroll();
    },
    [resetScroll],
  );

  const sources = model?.sources ?? [];
  const profile = model?.profile ?? "plain";

  const renderEvent = (event: LogEvent, height: number) => {
    const isExpanded = expanded.has(event.id);
    const hasStack = event.continuation.length > 0;
    const stackId = `${event.id}-stack`;

    const handleRowKeyDown = (keyboard: KeyboardEvent<HTMLDivElement>) => {
      if (keyboard.target !== keyboard.currentTarget) return;
      if (keyboard.key === "Enter" || keyboard.key === " ") {
        keyboard.preventDefault();
        onJumpToLine(event.line);
      }
    };

    return (
      <div
        key={event.id}
        className={cx("log-event", `is-${event.level}`, isExpanded && "is-expanded")}
        style={{ height }}
      >
        <div
          className="log-event-row"
          role="button"
          tabIndex={0}
          title={t("viewer.jumpToLine", { line: event.line })}
          onClick={() => onJumpToLine(event.line)}
          onKeyDown={handleRowKeyDown}
        >
          <span className="log-time" title={t("viewer.log.timezone")}>
            {event.time ?? "\u2014"}
          </span>
          <span className="log-level">{levelLabel(event.level, event.levelText)}</span>
          <span className="log-source">{event.source ?? "\u2014"}</span>
          <span className="log-message">{event.message || t("viewer.log.unknown")}</span>
          {hasStack ? (
            <button
              type="button"
              className="log-stack-toggle"
              aria-expanded={isExpanded}
              aria-controls={stackId}
              aria-label={t("viewer.log.stack", { count: event.continuation.length })}
              title={t("viewer.log.stack", { count: event.continuation.length })}
              onClick={(click) => {
                click.stopPropagation();
                toggleStack(event.id);
              }}
            >
              {isExpanded ? "\u25be" : "\u25b8"}
            </button>
          ) : (
            <span />
          )}
        </div>

        {isExpanded && hasStack && (
          <ul className="log-stack" id={stackId}>
            {event.continuation.map((line, index) => (
              <li key={`${line.line}-${index}`}>
                <button
                  type="button"
                  className="log-stack-line"
                  title={t("viewer.jumpToLine", { line: line.line })}
                  onClick={() => onJumpToLine(line.line)}
                >
                  <span className="log-stack-number">{line.line}</span>
                  <span className="log-stack-text">{line.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const toolbar = (
    <select
      className="log-profile"
      value={profileChoice}
      aria-label={t("viewer.log.profile")}
      title={t("viewer.log.profile")}
      onChange={(event) => changeProfile(event.target.value)}
    >
      <option value="auto">{`${t("viewer.log.auto")} \u2014 ${t(PROFILE_LABEL[profile])}`}</option>
      <option value="iso">{t("viewer.log.profile.iso")}</option>
      <option value="ndjson">{t("viewer.log.profile.ndjson")}</option>
      <option value="plain">{t("viewer.log.profile.plain")}</option>
    </select>
  );

  const subheader = (
    <div className="format-viewer-subheader log-subheader">
      <input
        type="search"
        value={query}
        placeholder={t("viewer.log.filter")}
        aria-label={t("viewer.log.filter")}
        onChange={(event) => {
          setQuery(event.target.value);
          resetScroll();
        }}
      />
      <select
        value={level}
        aria-label={t("viewer.log.filterLevel")}
        onChange={(event) => {
          setLevel(event.target.value as LogLevelFilter);
          resetScroll();
        }}
      >
        <option value="all">{t("viewer.log.allLevels")}</option>
        {LOG_LEVELS.map((item) => (
          <option key={item} value={item}>
            {levelLabel(item, item.toUpperCase())}
          </option>
        ))}
      </select>
      <select
        value={source}
        aria-label={t("viewer.log.source")}
        onChange={(event) => {
          setSource(event.target.value);
          resetScroll();
        }}
      >
        <option value="all">{t("viewer.log.source")}</option>
        {sources.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <span className="log-counter">
        {t("viewer.log.showing", { shown: filtered.shown, total: filtered.total })}
      </span>
      <span className="log-hint">{t("viewer.log.timezone")}</span>
    </div>
  );

  return (
    <ViewerShell
      modes={[
        { id: "events", label: t("viewer.mode.events") },
        { id: "source", label: t("viewer.mode.source") },
      ]}
      mode={mode}
      onMode={(id) => setMode(id === "source" ? "source" : "events")}
      toolbar={toolbar}
      diagnostics={result.diagnostics}
      onJumpToLine={onJumpToLine}
      subheader={subheader}
    >
      {mode === "source" ? (
        <SourceView content={content} onJumpToLine={onJumpToLine} />
      ) : (
        <div className="log-events-wrap">
          <div className="log-header" aria-hidden>
            <span>{t("viewer.log.time")}</span>
            <span>{t("viewer.log.level")}</span>
            <span>{t("viewer.log.source")}</span>
            <span>{t("viewer.log.message")}</span>
            <span />
          </div>

          {filtered.shown === 0 ? (
            <ViewerMessage title={t("viewer.log.noEvents")} />
          ) : (
            <div
              className={cx("log-events", stale && "is-stale")}
              ref={setScrollElement}
              onScroll={handleScroll}
              tabIndex={0}
              role="region"
              aria-label={t("viewer.mode.events")}
            >
              <div className="log-events-inner" style={{ height: metrics.total }}>
                <div
                  className="log-events-window"
                  style={{ transform: `translateY(${metrics.offsets[first]}px)` }}
                >
                  {filtered.events
                    .slice(first, last)
                    .map((event, offset) => renderEvent(event, metrics.heights[first + offset]))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </ViewerShell>
  );
}

/** Display label for a level: the file's own word, or the localised UNKNOWN. */
function levelLabel(level: LogLevel, levelText: string): string {
  return level === "unknown" ? t("viewer.log.unknown") : levelText;
}

/** First index whose offset is not below `value`. */
function lowerBound(offsets: readonly number[], value: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, Math.min(low, offsets.length - 1));
}
