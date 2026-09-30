/**
 * Workspace file tree.
 *
 * Only directories the user expanded are loaded, and each level is cached in
 * the workspace store, so the tree stays cheap on large repositories.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@/workspace/workspaceStore";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { settingsSnapshot } from "@/settings/settingsStore";
import * as ipc from "@/shared/ipc";
import { IpcError } from "@/shared/ipc";
import { t } from "@/shared/i18n";
import { basename, cx, dirname } from "@/shared/util";
import type { DirEntry } from "@/shared/types";

interface ContextMenuState {
  path: string;
  isDir: boolean;
  isMarkdown: boolean;
  x: number;
  y: number;
}

interface PendingCreate {
  parent: string;
  kind: "file" | "folder";
}

interface PendingRename {
  path: string;
}

export function Explorer() {
  const root = useWorkspaceStore((state) => state.root);
  const children = useWorkspaceStore((state) => state.children);
  const expanded = useWorkspaceStore((state) => state.expanded);
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const openFolderDialog = useWorkspaceStore((state) => state.openFolderDialog);
  const closeFolder = useWorkspaceStore((state) => state.closeFolder);
  const collapseAll = useWorkspaceStore((state) => state.collapseAll);

  const openPaths = useDocumentsStore((state) => state.openPaths);
  const activePath = useDocumentsStore(
    (state) => state.documents.find((document) => document.id === state.activeId)?.path ?? null,
  );

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState<PendingCreate | null>(null);
  const [renaming, setRenaming] = useState<PendingRename | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const beginCreate = useCallback(
    (parent: string, kind: "file" | "folder") => {
      setCreating({ parent, kind });
      setDraftName("");
      if (!expanded.includes(parent)) void toggleDirectory(parent);
    },
    [expanded, toggleDirectory],
  );

  const submitCreate = useCallback(async () => {
    if (!creating) return;
    const name = draftName.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    try {
      if (creating.kind === "file") {
        const path = await ipc.createFile(creating.parent, name, "");
        await refresh(creating.parent);
        if (name.toLowerCase().endsWith(".md") || name.toLowerCase().endsWith(".markdown")) {
          await openPaths([path]);
        }
      } else {
        await ipc.createDirectory(creating.parent, name);
        await refresh(creating.parent);
      }
      setCreating(null);
    } catch (failure) {
      setError(failure instanceof IpcError ? failure.message : String(failure));
    }
  }, [creating, draftName, openPaths, refresh]);

  const submitRename = useCallback(async () => {
    if (!renaming) return;
    const name = draftName.trim();
    if (!name || name === basename(renaming.path)) {
      setRenaming(null);
      return;
    }
    try {
      await ipc.renameEntry(renaming.path, name);
      useDocumentsStore.getState().handlePathRenamed(renaming.path, `${dirname(renaming.path)}/${name}`);
      await refresh(dirname(renaming.path));
      setRenaming(null);
    } catch (failure) {
      setError(failure instanceof IpcError ? failure.message : String(failure));
    }
  }, [renaming, draftName, refresh]);

  const requestDelete = useCallback(
    async (path: string, isDir: boolean) => {
      const name = basename(path);

      if (settingsSnapshot().files.confirmDelete) {
        const confirmed = await ipc.confirmDialog(
          t("dialog.deleteTitle"),
          isDir ? t("dialog.deleteBodyFolder", { name }) : t("dialog.deleteBody", { name }),
          {
            kind: "warning",
            buttons: "okCancel",
            okLabel: t("explorer.delete"),
            cancelLabel: t("common.cancel"),
          },
        );
        if (!confirmed) return;
      }

      try {
        await ipc.deleteEntry(path, false);
        const parent = dirname(path);
        // Release the file in Rust so its watcher and asset root are dropped.
        void ipc.closeDocument(path).catch(() => undefined);
        await refresh(parent);
      } catch (failure) {
        setError(failure instanceof IpcError ? failure.message : String(failure));
      }
    },
    [refresh],
  );

  const rootName = root ? basename(root) : null;

  const tree = useMemo(() => {
    if (!root) return null;
    return (
      <DirectoryList
        path={root}
        depth={0}
        children={children}
        expanded={expanded}
        activePath={activePath}
        creating={creating}
        renaming={renaming}
        draftName={draftName}
        onDraftChange={setDraftName}
        onDraftSubmit={() => {
          if (renaming) void submitRename();
          else void submitCreate();
        }}
        onDraftCancel={() => {
          setCreating(null);
          setRenaming(null);
        }}
        onToggle={(path) => void toggleDirectory(path)}
        onOpen={(path) => void openPaths([path])}
        onContextMenu={(state) => setMenu(state)}
      />
    );
  }, [
    root,
    children,
    expanded,
    activePath,
    creating,
    renaming,
    draftName,
    submitCreate,
    submitRename,
    toggleDirectory,
    openPaths,
  ]);

  return (
    <div className="explorer">
      <header className="panel-header">
        <span className="panel-title">{rootName ?? t("explorer.title")}</span>
        <div className="panel-actions">
          <button
            type="button"
            title={t("explorer.newFile")}
            onClick={() => root && beginCreate(root, "file")}
            disabled={!root}
          >
            +
          </button>
          <button
            type="button"
            title={t("explorer.newFolder")}
            onClick={() => root && beginCreate(root, "folder")}
            disabled={!root}
          >
            ⌸
          </button>
          <button
            type="button"
            title={t("explorer.refresh")}
            onClick={() => root && void refresh(root)}
            disabled={!root}
          >
            ⟳
          </button>
          <button type="button" title={t("explorer.collapseAll")} onClick={collapseAll} disabled={!root}>
            ⌄
          </button>
        </div>
      </header>

      <div className="explorer-body" ref={scrollRef}>
        {!root && (
          <div className="explorer-empty">
            <p>{t("explorer.noFolder")}</p>
            <button type="button" className="button primary" onClick={() => void openFolderDialog()}>
              {t("explorer.openFolder")}
            </button>
          </div>
        )}
        {root && tree}
        {root && (children[root]?.length ?? 0) === 0 && (
          <p className="explorer-hint">{t("explorer.empty")}</p>
        )}
      </div>

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {!menu.isDir && menu.isMarkdown && (
            <button type="button" onClick={() => void openPaths([menu.path])}>
              {t("file.open")}
            </button>
          )}
          <button
            type="button"
            onClick={() => beginCreate(menu.isDir ? menu.path : dirname(menu.path), "file")}
          >
            {t("explorer.newFile")}
          </button>
          <button
            type="button"
            onClick={() => beginCreate(menu.isDir ? menu.path : dirname(menu.path), "folder")}
          >
            {t("explorer.newFolder")}
          </button>
          <div className="context-menu-separator" />
          <button
            type="button"
            onClick={() => {
              setRenaming({ path: menu.path });
              setDraftName(basename(menu.path));
            }}
          >
            {t("explorer.rename")}
          </button>
          <button type="button" onClick={() => void requestDelete(menu.path, menu.isDir)}>
            {t("explorer.delete")}
          </button>
          <div className="context-menu-separator" />
          <button type="button" onClick={() => void ipc.revealInFileManager(menu.path)}>
            {t("explorer.reveal")}
          </button>
          {menu.isDir && (
            <button type="button" onClick={() => void refresh(menu.path)}>
              {t("explorer.refresh")}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="explorer-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {root && (
        <footer className="explorer-footer">
          <button type="button" onClick={() => void closeFolder()}>
            {t("explorer.closeFolder")}
          </button>
        </footer>
      )}
    </div>
  );
}

interface DirectoryListProps {
  path: string;
  depth: number;
  children: Record<string, DirEntry[]>;
  expanded: string[];
  activePath: string | null;
  creating: PendingCreate | null;
  renaming: PendingRename | null;
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftSubmit: () => void;
  onDraftCancel: () => void;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (state: ContextMenuState) => void;
}

function DirectoryList(props: DirectoryListProps) {
  const { path, depth, children, expanded, activePath } = props;
  const entries = children[path];

  if (!entries) {
    return <div className="tree-loading" style={{ paddingLeft: depth * 12 + 24 }} />;
  }

  const showCreateRow = props.creating && props.creating.parent === path;

  return (
    <ul className="tree" role="group">
      {showCreateRow && (
        <li className="tree-row tree-row--draft" style={{ paddingLeft: depth * 12 + 10 }}>
          <span className="tree-icon">{props.creating?.kind === "folder" ? "▸" : "·"}</span>
          <input
            className="tree-input"
            autoFocus
            value={props.draftName}
            placeholder={props.creating?.kind === "folder" ? t("explorer.newFolder") : t("explorer.newFile")}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onDraftSubmit();
              if (event.key === "Escape") props.onDraftCancel();
            }}
            onBlur={props.onDraftCancel}
          />
        </li>
      )}

      {entries.map((entry) => {
        const isExpanded = entry.isDir && expanded.includes(entry.path);
        const isRenaming = props.renaming?.path === entry.path;

        return (
          <li key={entry.path}>
            <div
              className={cx(
                "tree-row",
                entry.isDir ? "is-dir" : "is-file",
                entry.path === activePath && "is-active",
                !entry.isDir && !entry.isMarkdown && "is-secondary",
              )}
              style={{ paddingLeft: depth * 12 + 10 }}
              title={entry.path}
              onClick={() => {
                if (entry.isDir) props.onToggle(entry.path);
                else if (entry.isMarkdown) props.onOpen(entry.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu({
                  path: entry.path,
                  isDir: entry.isDir,
                  isMarkdown: entry.isMarkdown,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <span className="tree-icon">
                {entry.isDir ? (isExpanded ? "▾" : "▸") : entry.isMarkdown ? "▤" : "·"}
              </span>
              {isRenaming ? (
                <input
                  className="tree-input"
                  autoFocus
                  value={props.draftName}
                  onChange={(event) => props.onDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") props.onDraftSubmit();
                    if (event.key === "Escape") props.onDraftCancel();
                  }}
                  onBlur={props.onDraftSubmit}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span className="tree-label">{entry.name}</span>
              )}
              {entry.isSymlink && <span className="tree-badge">↗</span>}
            </div>

            {entry.isDir && isExpanded && <DirectoryList {...props} path={entry.path} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}
