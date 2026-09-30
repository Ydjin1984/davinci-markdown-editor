/** Open document tabs with drag reordering and a per-tab context menu. */

import { useEffect, useRef, useState } from "react";
import { useDocumentsStore } from "./documentsStore";
import { useUiStore } from "@/app/uiStore";
import * as ipc from "@/shared/ipc";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";
import { copyText } from "@/shared/clipboard";

interface ContextMenuState {
  documentId: string;
  x: number;
  y: number;
}

export function TabBar() {
  const documents = useDocumentsStore((state) => state.documents);
  const activeId = useDocumentsStore((state) => state.activeId);
  const activate = useDocumentsStore((state) => state.activate);
  const requestClose = useDocumentsStore((state) => state.requestClose);
  const closeOthers = useDocumentsStore((state) => state.closeOthers);
  const closeAll = useDocumentsStore((state) => state.closeAll);
  const reorder = useDocumentsStore((state) => state.reorder);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const dragIndex = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);

  if (documents.length === 0) {
    return <div className="tabbar tabbar--empty" />;
  }

  const menuDocument = menu ? documents.find((document) => document.id === menu.documentId) : undefined;

  return (
    <div className="tabbar" role="tablist">
      <div className="tabbar-scroll">
        {documents.map((document, index) => (
          <div
            key={document.id}
            role="tab"
            aria-selected={document.id === activeId}
            className={cx(
              "tab",
              document.id === activeId && "is-active",
              dropIndex === index && "is-drop-target",
              document.external !== "none" && "is-external",
            )}
            draggable
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDropIndex(index);
            }}
            onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== index) {
                reorder(dragIndex.current, index);
              }
              dragIndex.current = null;
              setDropIndex(null);
            }}
            onDragEnd={() => {
              dragIndex.current = null;
              setDropIndex(null);
            }}
            onMouseDown={(event) => {
              if (event.button === 0) activate(document.id);
              if (event.button === 1) {
                event.preventDefault();
                void requestClose(document.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              activate(document.id);
              setMenu({ documentId: document.id, x: event.clientX, y: event.clientY });
            }}
            title={document.path ?? document.title}
          >
            {document.external !== "none" && <span className="tab-warning" aria-hidden />}
            <span className="tab-title">{document.title}</span>
            <button
              type="button"
              className={cx("tab-close", document.dirty && "is-dirty")}
              aria-label={t("tab.close")}
              title={t("tab.close")}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void requestClose(document.id);
              }}
            >
              {document.dirty ? "●" : "✕"}
            </button>
          </div>
        ))}
      </div>

      {menu && menuDocument && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void requestClose(menuDocument.id)}>
            {t("tab.close")}
          </button>
          <button type="button" onClick={() => void closeOthers(menuDocument.id)}>
            {t("tab.closeOthers")}
          </button>
          <button type="button" onClick={() => void closeAll()}>
            {t("tab.closeAll")}
          </button>
          <div className="context-menu-separator" />
          <button
            type="button"
            disabled={!menuDocument.path}
            onClick={() => {
              if (!menuDocument.path) return;
              void copyText(menuDocument.path).then((copied) =>
                useUiStore
                  .getState()
                  .notify(copied ? t("toast.copied") : t("toast.copyFailed"), copied ? "success" : "error"),
              );
            }}
          >
            {t("tab.copyPath")}
          </button>
          <button
            type="button"
            disabled={!menuDocument.path}
            onClick={() => {
              if (menuDocument.path) void ipc.revealInFileManager(menuDocument.path);
            }}
          >
            {t("tools.revealInExplorer")}
          </button>
        </div>
      )}
    </div>
  );
}
