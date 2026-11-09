/**
 * Read-only source view used by the structured formats.
 *
 * The editor pane is where the file is edited; this view exists so a viewer can
 * show the exact bytes behind the model without switching panes. Windowing
 * keeps a 10 MiB log from creating a node per line.
 */

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";

import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";

const LINE_HEIGHT = 20;
const OVERSCAN = 12;
/** Lines rendered at once before the user is told the rest is in the editor. */
const MAX_LINES = 20_000;

interface SourceViewProps {
  content: string;
  onJumpToLine?: (line: number) => void;
  className?: string;
}

export function SourceView({ content, onJumpToLine, className }: SourceViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [activeLine, setActiveLine] = useState(0);

  const lines = content.split(/\r\n|\r|\n/);
  const total = Math.min(lines.length, MAX_LINES);
  const truncated = lines.length > MAX_LINES;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight || 600));
    observer.observe(element);
    setViewportHeight(element.clientHeight || 600);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
    setActiveLine(0);
  }, [content]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visible = Math.ceil(viewportHeight / LINE_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(total, first + visible);

  return (
    <div className={cx("format-source", className)}>
      <div
        className="format-source-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        tabIndex={0}
        role="region"
        aria-label={t("viewer.source")}
      >
        <div className="format-source-inner" style={{ height: total * LINE_HEIGHT }}>
          <div style={{ transform: `translateY(${first * LINE_HEIGHT}px)` }}>
            {lines.slice(first, last).map((line, index) => {
              const number = first + index + 1;
              return (
                <div
                  key={number}
                  className={cx("format-source-line", number === activeLine && "is-active")}
                  style={{ height: LINE_HEIGHT }}
                  onPointerDown={() => {
                    setActiveLine(number);
                    onJumpToLine?.(number);
                  }}
                >
                  <span className="format-source-number" aria-hidden>
                    {number}
                  </span>
                  <span className="format-source-text">{line || "\u00a0"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {truncated && (
        <p className="format-source-note">
          {t("viewer.sourceTruncated", { shown: MAX_LINES, total: lines.length })}
        </p>
      )}
    </div>
  );
}
