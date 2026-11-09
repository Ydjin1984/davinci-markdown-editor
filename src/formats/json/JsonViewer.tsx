/**
 * JSON document view: Tree and Source.
 *
 * The tree is built from the lossless model in `./parse`, so a number is shown
 * exactly as written and duplicate keys stay visible. Every row can jump to its
 * source line, copy its compact JSON, or copy its RFC 6901 JSON Pointer.
 *
 * Two safety valves keep the pane responsive: documents above
 * `HEAVY_CONTENT_LIMIT` are not parsed until the user asks for it, and the
 * rendered row list is capped. An unparsable document keeps the source
 * available and hides the tree rather than showing a wrong one.
 */

import { useCallback, useDeferredValue, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ViewerProps } from "@/documents/types";
import { SourceView, ViewerMessage, ViewerShell, useParsed } from "@/formats/shared";
import { copyText } from "@/shared/clipboard";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";

import {
  buildLineIndex,
  formatJson,
  lineColumnAt,
  minifyJson,
  minifyNode,
  parseJson,
  type JsonArrayNode,
  type JsonNode,
  type JsonObjectNode,
} from "./parse";
import { jsonPointer, type JsonPointerSegment } from "./pointer";
import "./styles.css";

/**
 * Documents larger than this are shown as source first; the tree is built only
 * on an explicit "Build view" command.
 */
export const HEAVY_CONTENT_LIMIT = 2 * 1024 * 1024;

/** Rows rendered at once; the rest is explained rather than rendered. */
export const MAX_VISIBLE_ROWS = 4_000;

/** Nodes inspected by the filter walk before it gives up on a huge tree. */
const FILTER_SCAN_LIMIT = 200_000;

type ViewerMode = "tree" | "source";
type BulkMode = "default" | "all" | "none";

/** One rendered tree row. */
interface TreeRow {
  /** Child-index path; unique even when duplicate keys repeat a pointer. */
  id: string;
  depth: number;
  /** Decoded object key; `null` for array items and the root. */
  key: string | null;
  /** Index inside the parent array; `null` for object entries and the root. */
  arrayIndex: number | null;
  /** Exact source lexeme of the key, quotes included. */
  rawKey: string | null;
  duplicate: boolean;
  node: JsonNode;
  pointer: string;
  /** Source offset where the row starts (the key for object entries). */
  offset: number;
  expandable: boolean;
  open: boolean;
}

/**
 * Per-document view state.
 *
 * It carries the document id so a new document starts with a clean filter and
 * no inherited collapse choices, without an effect that resets state after the
 * first paint.
 */
interface ViewState {
  documentId: string;
  filter: string;
  toggled: ReadonlyMap<string, boolean>;
  bulk: BulkMode;
  buildRequested: boolean;
}

const EMPTY_TOGGLED: ReadonlyMap<string, boolean> = new Map();

/** True when the document is large enough to need an explicit build step. */
export function shouldDeferBuild(content: string): boolean {
  return content.length > HEAVY_CONTENT_LIMIT;
}

function isContainer(node: JsonNode): node is JsonArrayNode | JsonObjectNode {
  return node.kind === "array" || node.kind === "object";
}

function childCount(node: JsonArrayNode | JsonObjectNode): number {
  return node.kind === "array" ? node.items.length : node.entries.length;
}

function matchesNeedle(node: JsonNode, needle: string): boolean {
  switch (node.kind) {
    case "string":
      return node.value.toLowerCase().includes(needle);
    case "number":
    case "boolean":
    case "null":
      return node.raw.toLowerCase().includes(needle);
    default:
      return false;
  }
}

/**
 * Ids of every node that matches the filter plus all their ancestors.
 *
 * The walk is budgeted: a pathological tree stops being searched instead of
 * blocking typing.
 */
function collectFilterMatches(root: JsonNode, needle: string): Set<string> {
  const visible = new Set<string>();
  let budget = FILTER_SCAN_LIMIT;

  const visit = (node: JsonNode, key: string | null, id: string, ancestors: readonly string[]): boolean => {
    if (budget <= 0) return false;
    budget -= 1;

    let hit = (key !== null && key.toLowerCase().includes(needle)) || matchesNeedle(node, needle);
    const path = [...ancestors, id];

    if (node.kind === "array") {
      for (let index = 0; index < node.items.length; index += 1) {
        if (visit(node.items[index], null, `${id}/${index}`, path)) hit = true;
      }
    } else if (node.kind === "object") {
      for (let index = 0; index < node.entries.length; index += 1) {
        const entry = node.entries[index];
        if (visit(entry.value, entry.key, `${id}/${index}`, path)) hit = true;
      }
    }

    if (hit) for (const ancestorId of path) visible.add(ancestorId);
    return hit;
  };

  visit(root, null, "", []);
  return visible;
}

interface BuildRowsOptions {
  filter: string;
  toggled: ReadonlyMap<string, boolean>;
  bulk: BulkMode;
}

/**
 * Flatten the tree into rows, honouring collapse state and the filter.
 *
 * Duplicate keys would collide in a pointer-based id, so identity comes from
 * the child index path and the JSON Pointer is stored next to it.
 */
function buildRows(root: JsonNode, options: BuildRowsOptions): { rows: TreeRow[]; truncated: boolean } {
  const { filter, toggled, bulk } = options;
  const filterActive = filter.length > 0;
  const visible = filterActive ? collectFilterMatches(root, filter) : null;
  const rows: TreeRow[] = [];
  let truncated = false;

  const isOpen = (id: string, depth: number): boolean => {
    if (filterActive) return visible !== null && visible.has(id);
    const toggledValue = toggled.get(id);
    if (toggledValue !== undefined) return toggledValue;
    if (bulk === "all") return true;
    if (bulk === "none") return false;
    return depth < 1;
  };

  const append = (
    node: JsonNode,
    key: string | null,
    rawKey: string | null,
    arrayIndex: number | null,
    duplicate: boolean,
    id: string,
    depth: number,
    segments: readonly JsonPointerSegment[],
    offset: number,
  ): void => {
    if (truncated) return;
    if (filterActive && (visible === null || !visible.has(id))) return;
    if (rows.length > MAX_VISIBLE_ROWS) {
      truncated = true;
      return;
    }

    const expandable = isContainer(node) && childCount(node) > 0;
    const open = expandable && isOpen(id, depth);
    rows.push({
      id,
      depth,
      key,
      rawKey,
      arrayIndex,
      duplicate,
      node,
      pointer: jsonPointer(segments),
      offset,
      expandable,
      open,
    });

    if (!open) return;
    if (node.kind === "array") {
      for (let index = 0; index < node.items.length; index += 1) {
        const item = node.items[index];
        append(item, null, null, index, false, `${id}/${index}`, depth + 1, [...segments, index], item.from);
      }
    } else if (node.kind === "object") {
      for (let index = 0; index < node.entries.length; index += 1) {
        const entry = node.entries[index];
        append(
          entry.value,
          entry.key,
          entry.rawKey,
          null,
          entry.duplicate,
          `${id}/${index}`,
          depth + 1,
          [...segments, entry.key],
          entry.keyFrom,
        );
      }
    }
  };

  append(root, null, null, null, false, "", 0, [], root.from);
  return { rows, truncated };
}

/** Value cell: a coloured primitive lexeme, or a count for a container. */
function valueCell(node: JsonNode): ReactNode {
  switch (node.kind) {
    case "object":
      return (
        <span className="format-tree-meta">{t("viewer.json.keys", { count: node.entries.length })}</span>
      );
    case "array":
      return (
        <span className="format-tree-meta">{t("viewer.json.elements", { count: node.items.length })}</span>
      );
    case "truncated":
      return <span className="format-tree-meta">{t("viewer.truncated")}</span>;
    default:
      return <span className={cx("format-tree-value", `is-${node.kind}`)}>{node.raw}</span>;
  }
}

export function JsonViewer(props: ViewerProps) {
  const { content, documentId, onJumpToLine, onReplaceContent } = props;

  const [mode, setMode] = useState<ViewerMode>("tree");
  const [view, setView] = useState<ViewState>({
    documentId,
    filter: "",
    toggled: EMPTY_TOGGLED,
    bulk: "default",
    buildRequested: false,
  });

  // Reading state for another document would leak its filter and collapse
  // choices, so a mismatch behaves like fresh state until the next update.
  const sameDocument = view.documentId === documentId;
  const filter = sameDocument ? view.filter : "";
  const toggled = sameDocument ? view.toggled : EMPTY_TOGGLED;
  const bulk: BulkMode = sameDocument ? view.bulk : "default";
  const buildRequested = sameDocument && view.buildRequested;

  const heavy = shouldDeferBuild(content);
  const awaitingBuild = heavy && !buildRequested;
  const parseEnabled = !awaitingBuild;

  const { result, stale } = useParsed(parseEnabled ? content : "", parseJson);
  const model = result.model;

  const setFilter = useCallback(
    (next: string) => {
      setView((previous) => ({
        documentId,
        filter: next,
        toggled: previous.documentId === documentId ? previous.toggled : EMPTY_TOGGLED,
        bulk: previous.documentId === documentId ? previous.bulk : "default",
        buildRequested: previous.documentId === documentId ? previous.buildRequested : false,
      }));
    },
    [documentId],
  );

  const toggleRow = useCallback(
    (id: string, open: boolean) => {
      setView((previous) => {
        const base = previous.documentId === documentId ? previous : null;
        const next = new Map(base?.toggled ?? EMPTY_TOGGLED);
        next.set(id, !open);
        return {
          documentId,
          filter: base?.filter ?? "",
          toggled: next,
          bulk: base?.bulk ?? "default",
          buildRequested: base?.buildRequested ?? false,
        };
      });
    },
    [documentId],
  );

  const applyBulk = useCallback(
    (nextBulk: BulkMode) => {
      setView((previous) => {
        const base = previous.documentId === documentId ? previous : null;
        return {
          documentId,
          filter: base?.filter ?? "",
          toggled: EMPTY_TOGGLED,
          bulk: nextBulk,
          buildRequested: base?.buildRequested ?? false,
        };
      });
    },
    [documentId],
  );

  const requestBuild = useCallback(() => {
    setView((previous) => {
      const base = previous.documentId === documentId ? previous : null;
      return {
        documentId,
        filter: base?.filter ?? "",
        toggled: base?.toggled ?? EMPTY_TOGGLED,
        bulk: base?.bulk ?? "default",
        buildRequested: true,
      };
    });
  }, [documentId]);

  const filterText = useDeferredValue(filter).trim().toLowerCase();
  const lineStarts = useMemo(() => buildLineIndex(content), [content]);

  const { rows, truncated: rowsTruncated } = useMemo(() => {
    if (model === null) return { rows: [] as TreeRow[], truncated: false };
    return buildRows(model.node, { filter: filterText, toggled, bulk });
  }, [model, filterText, toggled, bulk]);

  // A stale model describes the previous text: rewriting the buffer from it
  // would silently drop the characters just typed.
  const canRewrite = model !== null && !model.truncated && !stale && onReplaceContent !== undefined;

  const handleFormat = useCallback(() => {
    if (model === null || stale) return;
    const text = formatJson(model);
    if (text !== null) onReplaceContent?.(text);
  }, [model, stale, onReplaceContent]);

  const handleMinify = useCallback(() => {
    if (model === null || stale) return;
    const text = minifyJson(model);
    if (text !== null) onReplaceContent?.(text);
  }, [model, stale, onReplaceContent]);

  const jumpToOffset = useCallback(
    (offset: number) => {
      if (model === null) return;
      const position = lineColumnAt(lineStarts, offset);
      onJumpToLine(position.line, position.column);
    },
    [model, lineStarts, onJumpToLine],
  );

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, offset: number) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      jumpToOffset(offset);
    },
    [jumpToOffset],
  );

  const copyValue = useCallback((node: JsonNode) => {
    void copyText(minifyNode(node));
  }, []);

  const copyPointer = useCallback((pointer: string) => {
    void copyText(pointer);
  }, []);

  const diagnostics = parseEnabled ? result.diagnostics : [];
  const treeMode = mode === "tree" && !awaitingBuild;
  const firstError = result.diagnostics.find((item) => item.severity === "error");

  const toolbar = (
    <>
      <button type="button" onClick={handleFormat} disabled={!canRewrite}>
        {t("viewer.json.format")}
      </button>
      <button type="button" onClick={handleMinify} disabled={!canRewrite}>
        {t("viewer.json.minify")}
      </button>
      <button type="button" onClick={() => applyBulk("all")} disabled={!treeMode}>
        {t("viewer.expandAll")}
      </button>
      <button type="button" onClick={() => applyBulk("none")} disabled={!treeMode}>
        {t("viewer.collapseAll")}
      </button>
      {awaitingBuild && (
        <button type="button" onClick={requestBuild}>
          {t("viewer.build")}
        </button>
      )}
    </>
  );

  const subheader = treeMode ? (
    <div className="format-viewer-subheader">
      <label>
        <span>{t("viewer.search")}</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("viewer.json.filter")}
          aria-label={t("viewer.json.filter")}
        />
      </label>
      {filterText.length > 0 && <span>{t("viewer.items", { count: rows.length })}</span>}
      {model?.truncated && <span className="format-json-warning">{t("viewer.truncated")}</span>}
    </div>
  ) : undefined;

  let body: ReactNode;

  if (awaitingBuild) {
    body = (
      <div className="format-json-heavy">
        <ViewerMessage title={t("viewer.heavy")} />
        <div className="format-json-source">
          <SourceView content={content} onJumpToLine={onJumpToLine} />
        </div>
      </div>
    );
  } else if (mode === "source") {
    body = <SourceView content={content} onJumpToLine={onJumpToLine} />;
  } else if (model === null) {
    body = (
      <div className="format-json-invalid">
        <ViewerMessage tone="error" title={t("viewer.json.invalid")}>
          {firstError?.message ?? t("viewer.invalid")}
        </ViewerMessage>
        <div className="format-json-source">
          <SourceView content={content} onJumpToLine={onJumpToLine} />
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {stale && <p className="format-json-note">{t("viewer.stale")}</p>}
        {filterText.length > 0 && rows.length === 0 ? (
          <ViewerMessage title={t("viewer.noMatches")} />
        ) : (
          <div
            className={cx("format-tree", "format-json-tree", stale && "is-stale")}
            role="tree"
            aria-label={t("documents.kind.json")}
            aria-busy={stale || undefined}
          >
            {rows.map((row) => (
              <div
                key={row.id}
                className={cx("format-tree-row", "format-json-row", row.duplicate && "is-duplicate")}
                style={{ paddingLeft: 8 + row.depth * 16 }}
                role="treeitem"
                aria-expanded={row.expandable ? row.open : undefined}
                tabIndex={0}
                onPointerDown={() => jumpToOffset(row.offset)}
                onKeyDown={(event) => handleRowKeyDown(event, row.offset)}
              >
                {row.expandable ? (
                  <button
                    type="button"
                    className="format-tree-toggle"
                    aria-label={row.open ? t("viewer.collapseAll") : t("viewer.expandAll")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => toggleRow(row.id, row.open)}
                  >
                    {row.open ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="format-tree-toggle" aria-hidden />
                )}
                <span
                  className={cx("format-tree-key", "format-json-key", row.duplicate && "is-duplicate")}
                  title={row.duplicate ? t("viewer.json.duplicate", { key: row.key ?? "" }) : undefined}
                >
                  {row.key !== null
                    ? row.rawKey
                    : row.arrayIndex !== null
                      ? `[${row.arrayIndex}]`
                      : t("viewer.json.root")}
                </span>
                <span className="format-tree-meta" aria-hidden>
                  :
                </span>
                {valueCell(row.node)}
                <span className="format-json-actions">
                  {row.node.kind !== "truncated" && (
                    <button
                      type="button"
                      className="format-token-button"
                      aria-label={t("viewer.json.copyValue")}
                      title={t("viewer.json.copyValue")}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        copyValue(row.node);
                      }}
                    >
                      {t("viewer.copy")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="format-token-button"
                    aria-label={t("viewer.json.copyPointer")}
                    title={`${t("viewer.json.copyPointer")}: ${row.pointer || "/"}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      copyPointer(row.pointer);
                    }}
                  >
                    {t("viewer.json.copyPath")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {rowsTruncated && <p className="format-json-note">{t("viewer.truncated")}</p>}
      </>
    );
  }

  return (
    <ViewerShell
      className="format-json"
      modes={[
        { id: "tree", label: t("viewer.mode.tree") },
        { id: "source", label: t("viewer.mode.source") },
      ]}
      mode={mode}
      onMode={(next) => setMode(next === "source" ? "source" : "tree")}
      toolbar={toolbar}
      diagnostics={diagnostics}
      onJumpToLine={onJumpToLine}
      subheader={subheader}
    >
      {body}
    </ViewerShell>
  );
}
