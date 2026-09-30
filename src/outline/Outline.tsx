/** Document outline derived from the rendered heading tree. */

import { useMemo, useState } from "react";
import { usePreviewStore } from "@/preview/previewStore";
import { goToLine } from "@/editor/editorApi";
import { useCursorStore } from "@/editor/cursorStore";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";
import type { OutlineItem } from "@/shared/types";

/** Levels that start collapsed; deeper levels follow their parent. */
const DEFAULT_COLLAPSED_LEVEL = 3;

export function Outline() {
  const outline = usePreviewStore((state) => state.outline);
  const activeId = useDocumentsStore((state) => state.activeId);
  const cursorLine = useCursorStore((state) => (activeId ? (state.positions[activeId]?.line ?? 1) : 1));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const flat = useMemo(() => flatten(outline), [outline]);

  // Highlight the heading whose section contains the caret.
  const currentId = useMemo(() => {
    let found: string | null = null;
    for (const item of flat) {
      if (item.line <= cursorLine) found = item.id;
      else break;
    }
    return found;
  }, [flat, cursorLine]);

  function toggle(id: string): void {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (outline.length === 0) {
    return (
      <div className="outline">
        <header className="panel-header">
          <span className="panel-title">{t("outline.title")}</span>
        </header>
        <p className="outline-empty">{t("outline.empty")}</p>
      </div>
    );
  }

  return (
    <div className="outline">
      <header className="panel-header">
        <span className="panel-title">{t("outline.title")}</span>
      </header>
      <div className="outline-body">
        <OutlineBranch
          items={outline}
          collapsed={collapsed}
          currentId={currentId}
          onToggle={toggle}
          onSelect={(item) => goToLine(item.line)}
        />
      </div>
    </div>
  );
}

interface BranchProps {
  items: OutlineItem[];
  collapsed: Set<string>;
  currentId: string | null;
  onToggle: (id: string) => void;
  onSelect: (item: OutlineItem) => void;
}

function OutlineBranch({ items, collapsed, currentId, onToggle, onSelect }: BranchProps) {
  return (
    <ul className="outline-list">
      {items.map((item) => {
        const hasChildren = item.children.length > 0;
        const isCollapsed = collapsed.has(item.id) || item.level >= DEFAULT_COLLAPSED_LEVEL + 2;

        return (
          <li key={item.id}>
            <div
              className={cx("outline-row", `level-${item.level}`, item.id === currentId && "is-current")}
              onClick={() => onSelect(item)}
              title={item.text}
            >
              <button
                type="button"
                className={cx("outline-toggle", !hasChildren && "is-empty")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (hasChildren) onToggle(item.id);
                }}
                tabIndex={hasChildren ? 0 : -1}
                aria-hidden={!hasChildren}
              >
                {hasChildren ? (isCollapsed ? "▸" : "▾") : ""}
              </button>
              <span className="outline-text">{item.text}</span>
            </div>
            {hasChildren && !isCollapsed && (
              <OutlineBranch
                items={item.children}
                collapsed={collapsed}
                currentId={currentId}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Depth-first flattening used for the "current section" lookup. */
function flatten(items: OutlineItem[]): OutlineItem[] {
  const result: OutlineItem[] = [];
  const walk = (list: OutlineItem[]) => {
    for (const item of list) {
      result.push(item);
      walk(item.children);
    }
  };
  walk(items);
  result.sort((a, b) => a.line - b.line);
  return result;
}
