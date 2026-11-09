/**
 * CSV table viewer.
 *
 * The table is a read-only projection of the parsed model: sorting and
 * filtering only reorder what is shown, and the document bytes are never
 * touched. Rows are windowed by scroll position, so a 100 000-row file renders
 * a few dozen `<tr>` elements rather than 100 000.
 *
 * Every cell is a raw string: `000123`, `1,25` and `=SUM(A1)` are displayed as
 * text (React escapes them) and nothing is evaluated.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from "react";

import type { ParseResult, ViewerProps } from "@/documents/types";
import { SourceView, ViewerMessage, ViewerShell } from "@/formats/shared";
import { t, type StringKey } from "@/shared/i18n";
import { clamp, cx } from "@/shared/util";

import { CSV_DELIMITERS, isCsvDelimiter, parseCsv, type CsvDelimiter, type CsvTable } from "./parse";
import { cellAt, computeWindow, viewRecords, type CsvSort } from "./table";

const ROW_HEIGHT = 28;
const OVERSCAN = 8;
const DEFAULT_COLUMN_WIDTH = 180;
const RECORD_COLUMN_WIDTH = 64;
const MIN_COLUMN_WIDTH = 56;
const MAX_COLUMN_WIDTH = 960;
const DEFAULT_VIEWPORT_HEIGHT = 480;

/** Above this size the table is built only after the user asks for it. */
export const HEAVY_BYTES = 2 * 1024 * 1024;

const EMPTY_DIAGNOSTICS: ParseResult<CsvTable>["diagnostics"] = [];
const EMPTY_RECORDS: CsvTable["records"] = [];

function delimiterKey(delimiter: CsvDelimiter): StringKey {
  switch (delimiter) {
    case ",":
      return "viewer.csv.delimiterComma";
    case ";":
      return "viewer.csv.delimiterSemicolon";
    case "\t":
      return "viewer.csv.delimiterTab";
    case "|":
      return "viewer.csv.delimiterPipe";
    default:
      return "viewer.csv.delimiterComma";
  }
}

interface ResizeState {
  column: number;
  startX: number;
  startWidth: number;
}

/**
 * Remount the table for every document: filter, sort, dialect and column
 * widths belong to one file and must not leak into the next tab.
 */
export function CsvViewer(props: ViewerProps) {
  return <CsvViewerDocument key={props.documentId} {...props} />;
}

function CsvViewerDocument({ content, onJumpToLine }: ViewerProps) {
  const heavy = content.length > HEAVY_BYTES;

  const [mode, setMode] = useState<"table" | "source">(() => (heavy ? "source" : "table"));
  const [delimiter, setDelimiter] = useState<CsvDelimiter | null>(null);
  const [headerOn, setHeaderOn] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CsvSort | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  // Parse only while the table is on screen; the source mode stays instant even
  // for a file that is expensive to parse.
  const deferred = useDeferredValue(content);
  const tableMode = mode === "table";
  const parseResult = useMemo<ParseResult<CsvTable>>(() => {
    if (!tableMode) return { model: null, diagnostics: EMPTY_DIAGNOSTICS };
    return parseCsv(deferred, { delimiter: delimiter ?? undefined, header: headerOn });
  }, [tableMode, deferred, delimiter, headerOn]);

  const table = parseResult.model;
  const stale = deferred !== content;

  const records = table?.records ?? EMPTY_RECORDS;
  const rows = useMemo(() => viewRecords(records, query, sort), [records, query, sort]);

  // Scroll position is tagged with the view it belongs to, so changing the
  // filter, sort or dialect starts at the top without a state update in an
  // effect.
  const viewKey = `${delimiter ?? "auto"}\u0000${headerOn ? "1" : "0"}\u0000${query}\u0000${
    sort?.column ?? 0
  }\u0000${sort?.direction ?? ""}`;
  const [scroll, setScroll] = useState<{ key: string; top: number }>(() => ({ key: viewKey, top: 0 }));
  const scrollTop = scroll.key === viewKey ? scroll.top : 0;

  const windowRange = computeWindow(rows.length, scrollTop, viewportHeight, ROW_HEIGHT, OVERSCAN);
  const visibleRows = rows.slice(windowRange.first, windowRange.last);

  const widths = useMemo(
    () => (table ? table.columns.map((column) => columnWidths[column.index] ?? DEFAULT_COLUMN_WIDTH) : []),
    [table, columnWidths],
  );
  const tableWidth = RECORD_COLUMN_WIDTH + widths.reduce((sum, width) => sum + width, 0);

  // Window height follows the real scroll container, so the rendered slice
  // always covers the viewport instead of a fixed guess. ResizeObserver
  // delivers the first measurement asynchronously after subscribing.
  useEffect(() => {
    if (!tableMode) return;
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [tableMode]);

  // A changed view starts at the top of the scroll container.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
  }, [viewKey]);

  // Column resizing follows the pointer on the window, so dragging past the
  // header edge keeps working.
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;
      const width = clamp(
        resize.startWidth + event.clientX - resize.startX,
        MIN_COLUMN_WIDTH,
        MAX_COLUMN_WIDTH,
      );
      setColumnWidths((current) =>
        current[resize.column] === width ? current : { ...current, [resize.column]: width },
      );
    };
    const handleUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, []);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setScroll({ key: viewKey, top: event.currentTarget.scrollTop });
    },
    [viewKey],
  );

  const startResize = useCallback(
    (column: number, event: ReactPointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = {
        column,
        startX: event.clientX,
        startWidth: columnWidths[column] ?? DEFAULT_COLUMN_WIDTH,
      };
    },
    [columnWidths],
  );

  const toggleSort = (column: number) => {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      return current.direction === "asc" ? { column, direction: "desc" } : null;
    });
  };

  const modes = [
    { id: "table", label: t("viewer.mode.table") },
    { id: "source", label: t("viewer.mode.source") },
  ];

  const subheader =
    tableMode && table ? (
      <div className="format-viewer-subheader csv-subheader">
        <label className="csv-control">
          {t("viewer.csv.delimiter")}
          <select
            value={delimiter ?? table.dialect.delimiter}
            aria-label={t("viewer.csv.delimiter")}
            onChange={(event) => {
              const value = event.target.value;
              if (!isCsvDelimiter(value)) return;
              setDelimiter(value);
              setSort(null);
            }}
          >
            {CSV_DELIMITERS.map((option) => (
              <option key={delimiterKey(option)} value={option}>
                {t(delimiterKey(option))}
              </option>
            ))}
          </select>
        </label>

        <label className="csv-control">
          <input
            type="checkbox"
            checked={headerOn}
            onChange={(event) => {
              setHeaderOn(event.target.checked);
              setSort(null);
            }}
          />
          {t("viewer.csv.header")}
        </label>

        <span className="csv-counter">{t("viewer.csv.records", { count: records.length })}</span>
        <span className="csv-counter">{t("viewer.csv.columns", { count: table.width })}</span>

        <input
          className="csv-filter"
          type="search"
          value={query}
          placeholder={t("viewer.csv.filter")}
          aria-label={t("viewer.csv.filter")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
    ) : undefined;

  let body: ReactNode;
  if (!tableMode) {
    body = <SourceView content={content} onJumpToLine={onJumpToLine} />;
  } else if (!table) {
    body = <ViewerMessage tone="error" title={t("viewer.invalid")} />;
  } else if (table.records.length === 0) {
    body = <ViewerMessage title={t("viewer.csv.noRows")} />;
  } else if (rows.length === 0) {
    body = <ViewerMessage title={t("viewer.noMatches")} />;
  } else {
    body = (
      <div className={cx("csv-view", stale && "is-stale")}>
        <div
          className="csv-scroll"
          ref={scrollRef}
          onScroll={handleScroll}
          tabIndex={0}
          role="region"
          aria-label={t("viewer.mode.table")}
        >
          <table className="csv-table" style={{ width: tableWidth }}>
            <caption className="csv-caption">{t("documents.kind.csv")}</caption>
            <colgroup>
              <col style={{ width: RECORD_COLUMN_WIDTH }} />
              {widths.map((width, position) => (
                <col key={table.columns[position].id} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="csv-record-head">
                  {t("viewer.csv.record")}
                </th>
                {table.columns.map((column) => {
                  const active = sort !== null && sort.column === column.index;
                  const direction = active ? sort.direction : null;
                  const ariaSort =
                    direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={ariaSort}
                      className={cx("csv-head", active && "is-sorted")}
                    >
                      <button
                        type="button"
                        className="csv-sort"
                        onClick={() => toggleSort(column.index)}
                        title={direction === "asc" ? t("viewer.csv.sortDesc") : t("viewer.csv.sortAsc")}
                      >
                        <span className="csv-head-label">{column.label || `#${column.index}`}</span>
                        <span className="csv-sort-indicator" aria-hidden>
                          {direction === "asc" ? "▲" : direction === "desc" ? "▼" : ""}
                        </span>
                      </button>
                      <span
                        className="csv-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        onPointerDown={(event) => startResize(column.index, event)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {windowRange.first > 0 ? (
                <tr className="csv-spacer" aria-hidden style={{ height: windowRange.offset }}>
                  <td colSpan={table.columns.length + 1} />
                </tr>
              ) : null}
              {visibleRows.map((row) => (
                <tr key={row.index} className="csv-row" style={{ height: ROW_HEIGHT }}>
                  <td
                    className="csv-record"
                    onClick={() => onJumpToLine(row.line)}
                    title={t("viewer.jumpToLine", { line: row.line })}
                  >
                    {row.index}
                  </td>
                  {table.columns.map((column) => {
                    const value = cellAt(row, column.index);
                    return (
                      <td key={column.id} className="csv-cell" title={value}>
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {windowRange.last < rows.length ? (
                <tr
                  className="csv-spacer"
                  aria-hidden
                  style={{ height: windowRange.totalHeight - windowRange.offset - windowRange.height }}
                >
                  <td colSpan={table.columns.length + 1} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="csv-formula-note">{t("viewer.csv.formulaNote")}</p>
      </div>
    );
  }

  return (
    <ViewerShell
      modes={modes}
      mode={mode}
      onMode={(id) => setMode(id === "source" ? "source" : "table")}
      toolbar={stale ? <span className="csv-stale">{t("viewer.stale")}</span> : undefined}
      diagnostics={parseResult.diagnostics}
      onJumpToLine={onJumpToLine}
      subheader={subheader}
    >
      {body}
    </ViewerShell>
  );
}
