/**
 * XML tree viewer.
 *
 * The tree is built from the lossless model in `parse.ts`: elements, attributes,
 * text, CDATA, comments and processing instructions stay in source order, and
 * every row jumps back into the editor instead of leaving the user to search.
 * Attributes are rendered next to their element but are separate elements in the
 * DOM, so text is never mixed into a tag by accident.
 *
 * A document above `XML_HEAVY_BYTES` opens on the Source tab first: building a
 * tree for a huge file is a deliberate action, not a side effect of opening it.
 */

import { useMemo, useState, type ReactNode } from "react";

import { SourceView, ViewerMessage, ViewerShell, useParsed } from "@/formats/shared";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";
import type { Diagnostic, ViewerProps } from "@/documents/types";
import { parseXml, XML_HEAVY_BYTES, type XmlDocument, type XmlNode } from "./parse";

const MODE_TREE = "tree";
const MODE_SOURCE = "source";

/** Levels expanded on first paint; deeper branches open on click. */
const INITIAL_OPEN_DEPTH = 2;
/** Rows rendered at once; the rest of the tree stays one collapse away. */
const MAX_ROWS = 4_000;
const TEXT_PREVIEW = 260;
const ATTRIBUTE_PREVIEW = 120;

interface XmlRow {
  node: XmlNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

interface XmlView {
  rows: XmlRow[];
  /** True when `MAX_ROWS` cut the visible part of an expanded tree. */
  truncated: boolean;
}

function nodeKey(node: XmlNode): string {
  return `${node.kind}:${node.from}`;
}

/** Whitespace-only text carries formatting, not content; it stays hidden unless preserved. */
function isIgnorableText(node: XmlNode): boolean {
  return node.kind === "text" && !node.preserveSpace && node.text.trim() === "";
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function nodeMatches(node: XmlNode, needle: string): boolean {
  if (node.name.toLowerCase().includes(needle)) return true;
  if (node.text.toLowerCase().includes(needle)) return true;
  if (node.namespaceUri !== null && node.namespaceUri.toLowerCase().includes(needle)) return true;
  return node.attributes.some(
    (attribute) =>
      attribute.name.toLowerCase().includes(needle) ||
      attribute.value.toLowerCase().includes(needle) ||
      (attribute.namespaceUri !== null && attribute.namespaceUri.toLowerCase().includes(needle)),
  );
}

function filterNodes(nodes: readonly XmlNode[], needle: string): XmlNode[] {
  const kept: XmlNode[] = [];
  for (const node of nodes) {
    const filtered = filterNode(node, needle);
    if (filtered !== null) kept.push(filtered);
  }
  return kept;
}

/**
 * Keep a node when it matches, and keep ancestors of anything that matches.
 *
 * A matching element is kept whole, because its text and children are what the
 * user is looking for; only non-matching branches are pruned.
 */
function filterNode(node: XmlNode, needle: string): XmlNode | null {
  if (nodeMatches(node, needle)) return node;
  const children = filterNodes(node.children, needle);
  if (children.length === 0) return null;
  return { ...node, children };
}

/** Collapse everything below the first two levels, which is what a big file needs. */
function defaultCollapsed(model: XmlDocument | null): ReadonlySet<string> {
  const collapsed = new Set<string>();
  if (model === null) return collapsed;
  const walk = (nodes: readonly XmlNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.children.length > 0 && depth >= INITIAL_OPEN_DEPTH) {
        collapsed.add(nodeKey(node));
      } else if (depth < INITIAL_OPEN_DEPTH) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(model.nodes, 0);
  return collapsed;
}

function collapseEverything(model: XmlDocument | null): ReadonlySet<string> {
  const collapsed = new Set<string>();
  if (model === null) return collapsed;
  const walk = (nodes: readonly XmlNode[]): void => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        collapsed.add(nodeKey(node));
        walk(node.children);
      }
    }
  };
  walk(model.nodes);
  return collapsed;
}

function buildRows(model: XmlDocument | null, collapsed: ReadonlySet<string>, query: string): XmlView {
  if (model === null) return { rows: [], truncated: false };

  const needle = query.trim().toLowerCase();
  const roots = needle === "" ? model.nodes : filterNodes(model.nodes, needle);
  const rows: XmlRow[] = [];
  let truncated = false;

  const walk = (nodes: readonly XmlNode[], depth: number): void => {
    for (const node of nodes) {
      if (truncated) return;
      if (needle === "" && isIgnorableText(node)) continue;
      const expanded = needle !== "" || !collapsed.has(nodeKey(node));
      rows.push({ node, depth, hasChildren: node.children.length > 0, expanded });
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      if (expanded && node.children.length > 0) walk(node.children, depth + 1);
    }
  };

  walk(roots, 0);
  return { rows, truncated };
}

function AttributeList({
  attributes,
  kind,
}: {
  attributes: XmlNode["attributes"];
  kind: "attribute" | "declaration";
}) {
  return (
    <>
      {attributes.map((attribute) => (
        <span className={cx("xml-attribute", `is-${kind}`)} key={`${attribute.name}:${attribute.from}`}>
          <span className="xml-attribute-name">{attribute.name}</span>
          <span className="xml-attribute-value">
            {JSON.stringify(clip(attribute.value, ATTRIBUTE_PREVIEW))}
          </span>
        </span>
      ))}
    </>
  );
}

function XmlRowContent({ node }: { node: XmlNode }) {
  switch (node.kind) {
    case "element":
      return (
        <>
          <span className="format-tree-key xml-element-name">{node.name}</span>
          {node.namespaceUri === null ? null : (
            <span className="format-tree-meta xml-namespace" title={t("viewer.xml.namespace")}>
              {node.namespaceUri}
            </span>
          )}
          <AttributeList attributes={node.attributes} kind="attribute" />
          {node.selfClosing ? <span className="xml-punctuation">/&gt;</span> : null}
        </>
      );
    case "text":
      return (
        <>
          <span className="format-tree-meta xml-kind">{t("viewer.xml.text")}</span>
          <span className="format-tree-value xml-text">{JSON.stringify(clip(node.text, TEXT_PREVIEW))}</span>
        </>
      );
    case "cdata":
      return (
        <>
          <span className="format-tree-meta xml-kind">{t("viewer.xml.cdata")}</span>
          <span className="format-tree-value xml-cdata">{JSON.stringify(clip(node.text, TEXT_PREVIEW))}</span>
        </>
      );
    case "comment":
      return (
        <>
          <span className="format-tree-meta xml-kind">{t("viewer.xml.comment")}</span>
          <span className="format-tree-value xml-comment">
            {JSON.stringify(clip(node.text, TEXT_PREVIEW))}
          </span>
        </>
      );
    case "processing":
      return (
        <>
          <span className="format-tree-meta xml-kind">{t("viewer.xml.processing")}</span>
          <span className="format-tree-key xml-element-name">{node.name}</span>
          {node.text === "" ? null : (
            <span className="format-tree-value xml-text">
              {JSON.stringify(clip(node.text, TEXT_PREVIEW))}
            </span>
          )}
        </>
      );
    case "declaration":
      return (
        <>
          <span className="format-tree-meta xml-kind">{`<?${node.name}`}</span>
          <AttributeList attributes={node.attributes} kind="declaration" />
        </>
      );
    case "doctype":
      return <span className="format-tree-value xml-doctype">{clip(node.text, TEXT_PREVIEW)}</span>;
    default:
      return null;
  }
}

function XmlFallback({
  diagnostics,
  content,
  onJumpToLine,
}: {
  diagnostics: Diagnostic[];
  content: string;
  onJumpToLine: (line: number, column?: number) => void;
}) {
  const first = diagnostics.find((item) => item.severity === "error");
  return (
    <div className="xml-fallback">
      <ViewerMessage tone="error" title={t("viewer.xml.invalid")}>
        {first === undefined ? null : (
          <p className="xml-fallback-detail">
            {first.line}:{first.column} — {first.message}
          </p>
        )}
      </ViewerMessage>
      <SourceView content={content} onJumpToLine={onJumpToLine} className="xml-fallback-source" />
    </div>
  );
}

export function XmlViewer({ content, onJumpToLine }: ViewerProps) {
  const heavy = content.length > XML_HEAVY_BYTES;
  const [allowHeavy, setAllowHeavy] = useState(false);
  const [mode, setMode] = useState(MODE_TREE);
  const [query, setQuery] = useState("");
  // Collapse state is tied to the model it was made for: a new parse starts
  // from the default depth again, without an effect that would re-render twice.
  const [manualCollapse, setManualCollapse] = useState<{
    model: XmlDocument | null;
    collapsed: ReadonlySet<string>;
  } | null>(null);

  // Skipping the parse is what keeps opening a 100 MiB XML file instant.
  const skipped = heavy && !allowHeavy;
  const { result, stale } = useParsed(skipped ? "" : content, parseXml);
  const parsed = skipped ? null : result;
  const model = parsed === null ? null : parsed.model;
  const diagnostics = parsed === null ? [] : parsed.diagnostics;

  const collapsed = useMemo(
    () =>
      manualCollapse !== null && manualCollapse.model === model
        ? manualCollapse.collapsed
        : defaultCollapsed(model),
    [manualCollapse, model],
  );
  const hasQuery = query.trim() !== "";
  const view = useMemo(() => buildRows(model, collapsed, query), [model, collapsed, query]);
  const effectiveMode = skipped ? MODE_SOURCE : mode;

  const applyCollapse = (next: ReadonlySet<string>): void => {
    setManualCollapse({ model, collapsed: next });
  };

  const toggle = (key: string): void => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    applyCollapse(next);
  };

  const toolbar =
    effectiveMode === MODE_TREE ? (
      <>
        <input
          type="search"
          value={query}
          placeholder={t("viewer.search")}
          aria-label={t("viewer.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={() => applyCollapse(new Set<string>())}>
          {t("viewer.expandAll")}
        </button>
        <button type="button" onClick={() => applyCollapse(collapseEverything(model))}>
          {t("viewer.collapseAll")}
        </button>
      </>
    ) : skipped ? (
      <button
        type="button"
        onClick={() => {
          setAllowHeavy(true);
          setMode(MODE_TREE);
        }}
      >
        {t("viewer.build")}
      </button>
    ) : null;

  const subheader =
    effectiveMode === MODE_TREE && model !== null ? (
      <div className="format-viewer-subheader">
        <span>{t("viewer.items", { count: model.elementCount })}</span>
        {model.namespaces.map((namespace) => (
          <span key={`${namespace.prefix}:${namespace.from}`} title={t("viewer.xml.namespace")}>
            {namespace.prefix === ""
              ? `xmlns=${JSON.stringify(namespace.uri)}`
              : `xmlns:${namespace.prefix}=${JSON.stringify(namespace.uri)}`}
          </span>
        ))}
      </div>
    ) : undefined;

  let body: ReactNode;
  if (effectiveMode === MODE_SOURCE) {
    body = <SourceView content={content} onJumpToLine={onJumpToLine} />;
  } else if (model === null) {
    body = <XmlFallback diagnostics={diagnostics} content={content} onJumpToLine={onJumpToLine} />;
  } else {
    body = (
      <div className={cx("xml-body", stale && "is-stale")}>
        {model.truncated || view.truncated ? <p className="xml-note">{t("viewer.truncated")}</p> : null}
        {view.rows.length === 0 ? (
          <ViewerMessage tone="muted" title={hasQuery ? t("viewer.noMatches") : t("viewer.invalid")} />
        ) : (
          <ul className="format-tree-list xml-tree" role="tree" aria-label={t("viewer.mode.tree")}>
            {view.rows.map((row) => (
              <li
                key={nodeKey(row.node)}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                tabIndex={0}
                className="format-tree-row xml-row"
                style={{ paddingLeft: 8 + row.depth * 14 }}
                onClick={() => onJumpToLine(row.node.line, row.node.column)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onJumpToLine(row.node.line, row.node.column);
                  }
                }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="format-tree-toggle"
                    aria-label={row.expanded ? t("viewer.collapseAll") : t("viewer.expandAll")}
                    aria-expanded={row.expanded}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(nodeKey(row.node));
                    }}
                  >
                    {row.expanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="format-tree-toggle" aria-hidden="true" />
                )}
                <XmlRowContent node={row.node} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <ViewerShell
      modes={[
        { id: MODE_TREE, label: t("viewer.mode.tree") },
        { id: MODE_SOURCE, label: t("viewer.mode.source") },
      ]}
      mode={effectiveMode}
      onMode={(next) => {
        if (next === MODE_TREE && skipped) {
          setAllowHeavy(true);
          setMode(MODE_TREE);
          return;
        }
        setMode(next);
      }}
      toolbar={toolbar}
      diagnostics={diagnostics}
      onJumpToLine={onJumpToLine}
      subheader={subheader}
      className="xml-viewer"
    >
      {body}
    </ViewerShell>
  );
}
