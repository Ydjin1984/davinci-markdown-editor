/**
 * Shared building blocks for the structured viewers.
 *
 * Every format owns its parser and its view, but the chrome around them should
 * not drift: one mode switch, one diagnostics strip, one source view.
 */

import { useDeferredValue, useId, useMemo, type ReactNode } from "react";

import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";
import type { Diagnostic, ParseResult } from "@/documents/types";

export interface ViewerModeOption {
  id: string;
  label: string;
}

export interface ViewerShellProps {
  /** Mode switch entries; omitted for formats with one representation. */
  modes?: ViewerModeOption[];
  mode?: string;
  onMode?: (id: string) => void;
  /** Buttons rendered on the right of the bar. */
  toolbar?: ReactNode;
  diagnostics?: Diagnostic[];
  onJumpToLine?: (line: number, column?: number) => void;
  /** Extra content between the bar and the body (filter rows, counters). */
  subheader?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Frame shared by the JSON, CSV, LOG and XML views.
 *
 * Diagnostics are listed above the content and are clickable: a parse error is
 * only useful if it takes the user to the line that caused it.
 */
export function ViewerShell({
  modes,
  mode,
  onMode,
  toolbar,
  diagnostics = [],
  onJumpToLine,
  subheader,
  children,
  className,
}: ViewerShellProps) {
  const headingId = useId();
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const visible = [...errors, ...warnings].slice(0, 6);
  const hiddenCount = errors.length + warnings.length - visible.length;

  return (
    <div className={cx("format-viewer", className)}>
      <div className="format-viewer-bar" role="toolbar" aria-labelledby={headingId}>
        <span id={headingId} className="format-viewer-hidden-heading">
          {t("viewer.title")}
        </span>

        {modes && modes.length > 1 && mode !== undefined && onMode ? (
          <div className="format-viewer-modes" role="group" aria-label={t("viewer.mode")}>
            {modes.map((option) => (
              <button
                key={option.id}
                type="button"
                className={cx("format-viewer-mode", option.id === mode && "is-active")}
                aria-pressed={option.id === mode}
                onClick={() => onMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="format-viewer-title">{t("viewer.title")}</span>
        )}

        <div className="format-viewer-tools">{toolbar}</div>
      </div>

      {visible.length > 0 && (
        <ul className="format-diagnostics" aria-label={t("viewer.diagnostics")}>
          {visible.map((diagnostic, index) => (
            <li key={`${diagnostic.from}-${index}`}>
              <button
                type="button"
                className={cx("format-diagnostic", `is-${diagnostic.severity}`)}
                onClick={() => onJumpToLine?.(diagnostic.line, diagnostic.column)}
                title={t("viewer.jumpToLine", { line: diagnostic.line })}
              >
                <span className="format-diagnostic-location">
                  {diagnostic.line}:{diagnostic.column}
                </span>
                <span className="format-diagnostic-message">{diagnostic.message}</span>
              </button>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="format-diagnostics-more">{t("viewer.moreDiagnostics", { count: hiddenCount })}</li>
          )}
        </ul>
      )}

      {subheader}
      <div className="format-viewer-body">{children}</div>
    </div>
  );
}

export interface ViewerMessageProps {
  tone?: "muted" | "error";
  title: string;
  children?: ReactNode;
}

/** Placeholder shown when a viewer has nothing to display. */
export function ViewerMessage({ tone = "muted", title, children }: ViewerMessageProps) {
  return (
    <div className={cx("format-viewer-message", `is-${tone}`)} role={tone === "error" ? "alert" : "status"}>
      <p className="format-viewer-message-title">{title}</p>
      {children ? <div className="format-viewer-message-body">{children}</div> : null}
    </div>
  );
}

/**
 * Parse `source`, keeping the previous result on screen while the new one is
 * being prepared.
 *
 * `useDeferredValue` lets React keep typing responsive by rendering the stale
 * view first; `stale` tells the viewer to dim the output instead of pretending
 * it is current.
 */
export function useParsed<Model>(
  source: string,
  parse: (source: string) => ParseResult<Model>,
): { result: ParseResult<Model>; stale: boolean } {
  const deferred = useDeferredValue(source);
  const result = useMemo(() => parse(deferred), [parse, deferred]);
  return { result, stale: deferred !== source };
}
