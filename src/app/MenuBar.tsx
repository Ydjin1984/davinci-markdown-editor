/**
 * Application menu bar.
 *
 * Implemented in HTML rather than as a native menu so Windows and Linux behave
 * identically and the menus can show richer content (recent files, diagram
 * templates) without a second code path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redo, selectAll as selectAllCommand, undo } from "@codemirror/commands";
import { useSettingsStore } from "@/settings/settingsStore";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { useWorkspaceStore } from "@/workspace/workspaceStore";
import { useUiStore } from "@/app/uiStore";
import * as ipc from "@/shared/ipc";
import { basename, cx } from "@/shared/util";
import { t } from "@/shared/i18n";
import { focusEditor, insertCodeBlock, insertTable, insertText, runEditorCommand } from "@/editor/editorApi";
import {
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleTaskList,
  insertLink,
  insertImageCommand,
  toggleHorizontalRule,
} from "@/editor/codemirror/commands";
import { DIAGRAM_TEMPLATES, fencedDiagram } from "@/mermaid/templates";
import { buildExportHtml, exportFileName } from "@/preview/exportHtml";
import { copyText } from "@/shared/clipboard";
import type { LayoutMode } from "@/shared/types";

interface MenuEntry {
  label?: string;
  shortcut?: string;
  /** Return values are ignored; `void` keeps call sites honest. */
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  items?: MenuEntry[];
}

/** Fire-and-forget wrapper for async menu actions. */
function run(task: () => Promise<unknown>): () => void {
  return () => {
    void task().catch((error) => {
      console.error("Menu action failed", error);
    });
  };
}

/**
 * Grace period before a leaf row closes the submenu.
 *
 * Long enough for the pointer to cross the small gap between a row and the
 * submenu beside it, short enough that leaving the menu still feels immediate.
 */
const SUBMENU_CLOSE_DELAY_MS = 200;

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Drop a scheduled submenu close. */
  const cancelPendingClose = useCallback(() => {
    if (closeTimer.current !== undefined) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }, []);

  useEffect(() => cancelPendingClose, [cancelPendingClose]);

  /**
   * Hover behaviour for rows in the top-level list.
   *
   * A row that owns a submenu opens it immediately. A leaf row schedules the
   * close instead of applying it, which leaves the pointer time to travel
   * diagonally into the submenu without passing through a gap.
   */
  const handleRowHover = useCallback(
    (label: string | null) => {
      cancelPendingClose();
      if (label !== null) {
        setOpenSubmenu(label);
        return;
      }
      closeTimer.current = setTimeout(() => {
        closeTimer.current = undefined;
        setOpenSubmenu(null);
      }, SUBMENU_CLOSE_DELAY_MS);
    },
    [cancelPendingClose],
  );

  const settings = useSettingsStore((state) => state.settings);
  const patch = useSettingsStore((state) => state.patch);
  const reset = useSettingsStore((state) => state.reset);
  const openDialog = useUiStore((state) => state.openDialog);

  const hasDocument = useDocumentsStore((state) => state.documents.length > 0);
  const activeDocument = useDocumentsStore(
    (state) => state.documents.find((item) => item.id === state.activeId) ?? null,
  );
  const hasWorkspace = useWorkspaceStore((state) => state.root !== null);

  useEffect(() => {
    if (!openMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (barRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
      setOpenSubmenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [openMenu]);

  const openFiles = async () => {
    const paths = await ipc.pickOpenFiles();
    if (paths.length > 0) await useDocumentsStore.getState().openPaths(paths);
  };

  const setLayout = (layout: LayoutMode) => patch("view", { layout });

  const exportHtml = async () => {
    if (!activeDocument) return;
    const documentDir = activeDocument.path?.replace(/[\\/][^\\/]*$/, "") ?? null;
    const html = buildExportHtml({
      title: activeDocument.title,
      documentDir,
      appearance: useUiStore.getState().appearance,
    });
    const path = await ipc.pickSavePath(exportFileName(activeDocument.title, "html"), "html", null);
    if (!path) return;
    try {
      await ipc.writeExportFile(path, html);
      useUiStore.getState().notify(t("toast.exported", { name: basename(path) }), "success");
    } catch (error) {
      await ipc.confirmDialog(t("error.genericTitle"), String(error), { kind: "error" });
    }
  };

  const copyHtml = async () => {
    if (!activeDocument) return;
    const documentDir = activeDocument.path?.replace(/[\\/][^\\/]*$/, "") ?? null;
    const html = buildExportHtml({
      title: activeDocument.title,
      documentDir,
      appearance: useUiStore.getState().appearance,
    });
    const copied = await copyText(html);
    useUiStore
      .getState()
      .notify(copied ? t("toast.copied") : t("toast.copyFailed"), copied ? "success" : "error");
  };

  const menus = useMemo<Record<string, MenuEntry[]>>(() => {
    const documents = useDocumentsStore.getState().documents;
    const recentFiles = settings.files.recentFiles;
    const recentWorkspaces = settings.files.recentWorkspaces;

    return {
      [t("menu.file")]: [
        {
          label: t("file.new"),
          shortcut: `${mod}+N`,
          run: () => {
            useDocumentsStore.getState().createUntitled();
          },
        },
        { label: t("file.open"), shortcut: `${mod}+O`, run: run(openFiles) },
        {
          label: t("file.openFolder"),
          shortcut: `${mod}+Shift+O`,
          run: run(() => useWorkspaceStore.getState().openFolderDialog()),
        },
        {
          label: t("file.openRecent"),
          disabled: recentFiles.length === 0 && recentWorkspaces.length === 0,
          items: [
            ...recentWorkspaces.map((path) => ({
              label: `${basename(path)}/`,
              run: async () => {
                const root = await ipc.openWorkspace(path);
                await useWorkspaceStore.getState().setRoot(root);
              },
            })),
            ...(recentWorkspaces.length > 0 && recentFiles.length > 0 ? [{ separator: true }] : []),
            ...recentFiles.map((entry) => ({
              label: entry.name,
              run: run(() => useDocumentsStore.getState().openPaths([entry.path], { silent: true })),
            })),
            ...(recentFiles.length > 0 || recentWorkspaces.length > 0
              ? [{ separator: true }, { label: t("file.clearRecent"), run: () => void ipc.clearRecent() }]
              : []),
          ],
        },
        { separator: true },
        {
          label: t("file.save"),
          shortcut: `${mod}+S`,
          disabled: !activeDocument,
          run: async () => {
            const id = useDocumentsStore.getState().activeId;
            if (id) await useDocumentsStore.getState().save(id);
          },
        },
        {
          label: t("file.saveAs"),
          shortcut: `${mod}+Shift+S`,
          disabled: !activeDocument,
          run: async () => {
            const id = useDocumentsStore.getState().activeId;
            if (id) await useDocumentsStore.getState().save(id, { saveAs: true });
          },
        },
        {
          label: t("file.saveAll"),
          disabled: !documents.some((document) => document.dirty),
          run: run(() => useDocumentsStore.getState().saveAll()),
        },
        { separator: true },
        {
          label: t("file.closeTab"),
          shortcut: `${mod}+W`,
          disabled: !activeDocument,
          run: async () => {
            const id = useDocumentsStore.getState().activeId;
            if (id) await useDocumentsStore.getState().requestClose(id);
          },
        },
        {
          label: t("file.closeOthers"),
          disabled: documents.length < 2,
          run: async () => {
            const id = useDocumentsStore.getState().activeId;
            if (id) await useDocumentsStore.getState().closeOthers(id);
          },
        },
        {
          label: t("file.closeAll"),
          disabled: documents.length === 0,
          run: run(() => useDocumentsStore.getState().closeAll()),
        },
        {
          label: t("file.reopenClosed"),
          run: () => {
            useDocumentsStore.getState().reopenClosed();
          },
        },
        { separator: true },
        { label: t("file.exit"), run: () => void quitApplication() },
      ],

      [t("menu.edit")]: [
        { label: t("edit.undo"), shortcut: `${mod}+Z`, run: () => runEditorCommand(undo) },
        { label: t("edit.redo"), shortcut: `${mod}+Shift+Z`, run: () => runEditorCommand(redo) },
        { separator: true },
        { label: t("edit.cut"), shortcut: `${mod}+X`, run: run(cutSelection) },
        { label: t("edit.copy"), shortcut: `${mod}+C`, run: run(copySelection) },
        { label: t("edit.paste"), shortcut: `${mod}+V`, run: run(pasteIntoEditor) },
        { label: t("edit.selectAll"), shortcut: `${mod}+A`, run: () => runEditorCommand(selectAllCommand) },
        { separator: true },
        { label: t("edit.find"), shortcut: `${mod}+F`, run: run(() => openSearch("find")) },
        { label: t("edit.replace"), shortcut: `${mod}+H`, run: run(() => openSearch("replace")) },
      ],

      [t("menu.view")]: [
        {
          label: t("view.editor"),
          checked: settings.view.layout === "editor",
          run: () => setLayout("editor"),
        },
        {
          label: t("view.preview"),
          checked: settings.view.layout === "preview",
          run: () => setLayout("preview"),
        },
        {
          label: t("view.splitVertical"),
          checked: settings.view.layout === "split-v",
          run: () => setLayout("split-v"),
        },
        {
          label: t("view.splitHorizontal"),
          checked: settings.view.layout === "split-h",
          run: () => setLayout("split-h"),
        },
        { separator: true },
        {
          label: t("view.explorer"),
          checked: settings.view.showExplorer,
          run: () => patch("view", { showExplorer: !settings.view.showExplorer }),
        },
        {
          label: t("view.outline"),
          checked: settings.view.showOutline,
          run: () => patch("view", { showOutline: !settings.view.showOutline }),
        },
        { separator: true },
        {
          label: t("view.wordWrap"),
          checked: settings.editor.wordWrap,
          run: () => patch("editor", { wordWrap: !settings.editor.wordWrap }),
        },
        {
          label: t("view.syncScroll"),
          checked: settings.preview.syncScroll,
          run: () => patch("preview", { syncScroll: !settings.preview.syncScroll }),
        },
        { separator: true },
        {
          label: t("view.zoomIn"),
          run: () => patch("application", { zoom: Math.min(settings.application.zoom + 0.1, 3) }),
        },
        {
          label: t("view.zoomOut"),
          run: () => patch("application", { zoom: Math.max(settings.application.zoom - 0.1, 0.5) }),
        },
        { label: t("view.zoomReset"), run: () => patch("application", { zoom: 1 }) },
      ],

      [t("menu.insert")]: [
        {
          label: t("insert.link"),
          shortcut: `${mod}+K`,
          disabled: !activeDocument,
          run: () => runEditorCommand(insertLink),
        },
        {
          label: t("insert.image"),
          shortcut: `${mod}+Shift+K`,
          disabled: !activeDocument,
          run: () => runEditorCommand(insertImageCommand),
        },
        { separator: true },
        { label: "Heading 1", run: () => runEditorCommand(setHeading(1)) },
        { label: "Heading 2", run: () => runEditorCommand(setHeading(2)) },
        { label: "Heading 3", run: () => runEditorCommand(setHeading(3)) },
        { separator: true },
        { label: t("insert.table"), disabled: !activeDocument, run: () => insertTable() },
        { label: t("insert.codeBlock"), disabled: !activeDocument, run: () => insertCodeBlock() },
        {
          label: t("insert.taskList"),
          disabled: !activeDocument,
          run: () => runEditorCommand(toggleTaskList),
        },
        {
          label: t("insert.blockquote"),
          disabled: !activeDocument,
          run: () => runEditorCommand(toggleBlockquote),
        },
        {
          label: t("insert.horizontalRule"),
          disabled: !activeDocument,
          run: () => runEditorCommand(toggleHorizontalRule),
        },
        { separator: true },
        {
          label: t("insert.diagram"),
          disabled: !activeDocument,
          items: DIAGRAM_TEMPLATES.map((template) => ({
            label: template.label,
            run: () => insertText(fencedDiagram(template)),
          })),
        },
      ],

      [t("menu.tools")]: [
        {
          label: t("tools.settings"),
          shortcut: `${mod}+,`,
          run: () => {
            openDialog("settings");
          },
        },
        { separator: true },
        { label: t("tools.copyHtml"), disabled: !activeDocument, run: run(copyHtml) },
        { label: t("tools.exportHtml"), disabled: !activeDocument, run: run(exportHtml) },
        { separator: true },
        {
          label: t("tools.revealInExplorer"),
          disabled: !activeDocument?.path,
          run: () => {
            if (activeDocument?.path) void ipc.revealInFileManager(activeDocument.path);
          },
        },
        {
          label: t("tools.assetRoots"),
          run: () => {
            openDialog("assetAccess");
          },
        },
        { separator: true },
        {
          label: t("settings.reset"),
          run: async () => {
            const confirmed = await ipc.confirmDialog(t("settings.reset"), t("settings.resetConfirm"), {
              kind: "warning",
              buttons: "okCancel",
              okLabel: t("settings.reset"),
              cancelLabel: t("common.cancel"),
            });
            if (confirmed) await reset();
          },
        },
      ],

      [t("menu.help")]: [
        {
          label: t("help.keyboard"),
          run: () => {
            openDialog("shortcuts");
          },
        },
        {
          label: t("help.about"),
          run: () => {
            openDialog("about");
          },
        },
      ],
    };
    // The menu contents are derived from settings and open documents; both are
    // already reactive dependencies of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, activeDocument, hasWorkspace, hasDocument]);

  return (
    <div className="menubar" ref={barRef}>
      {Object.entries(menus).map(([title, entries]) => (
        <div key={title} className="menubar-item">
          <button
            type="button"
            className={cx("menubar-button", openMenu === title && "is-open")}
            onPointerDown={(event) => {
              event.stopPropagation();
              cancelPendingClose();
              setOpenMenu(openMenu === title ? null : title);
              setOpenSubmenu(null);
            }}
            onPointerEnter={() => {
              if (openMenu && openMenu !== title) {
                cancelPendingClose();
                setOpenMenu(title);
                setOpenSubmenu(null);
              }
            }}
          >
            {title}
          </button>

          {openMenu === title && (
            <div className="menu-dropdown" onPointerDown={(event) => event.stopPropagation()}>
              {entries.map((entry, index) => (
                <MenuRow
                  key={`${entry.label ?? "sep"}-${index}`}
                  entry={entry}
                  openSubmenu={openSubmenu}
                  onHoverRow={handleRowHover}
                  onKeepOpen={cancelPendingClose}
                  onClose={() => {
                    cancelPendingClose();
                    setOpenMenu(null);
                    setOpenSubmenu(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface MenuRowProps {
  entry: MenuEntry;
  openSubmenu: string | null;
  /** True for rows rendered inside an open submenu. */
  nested?: boolean;
  onHoverRow: (label: string | null) => void;
  /** Cancel a scheduled submenu close, e.g. while the pointer is inside it. */
  onKeepOpen: () => void;
  onClose: () => void;
}

function MenuRow({ entry, openSubmenu, nested, onHoverRow, onKeepOpen, onClose }: MenuRowProps) {
  if (entry.separator) return <div className="menu-separator" />;

  const hasSubmenu = (entry.items?.length ?? 0) > 0;

  return (
    <div className="menu-row-wrapper">
      <button
        type="button"
        className={cx("menu-row", entry.disabled && "is-disabled", openSubmenu === entry.label && "is-open")}
        disabled={entry.disabled}
        onPointerEnter={() => {
          // A row inside an open submenu must leave the parent's selection
          // alone. Treating it like a top-level row used to clear the open
          // submenu, unmounting the list the pointer was moving into.
          if (nested) {
            // Entering a row inside the open submenu must never schedule a
            // close, whichever order the browser delivers the enter events in.
            onKeepOpen();
            return;
          }
          onHoverRow(hasSubmenu ? (entry.label ?? null) : null);
        }}
        onClick={() => {
          if (hasSubmenu || entry.disabled) return;
          void entry.run?.();
          onClose();
        }}
      >
        <span className="menu-check">{entry.checked ? "✓" : ""}</span>
        <span className="menu-label">{entry.label}</span>
        {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
        {hasSubmenu && <span className="menu-arrow">▸</span>}
      </button>

      {hasSubmenu && openSubmenu === entry.label && (
        <div className="menu-dropdown menu-submenu" onPointerEnter={onKeepOpen}>
          {entry.items?.map((child, index) => (
            <MenuRow
              key={`${child.label ?? "sep"}-${index}`}
              entry={child}
              openSubmenu={openSubmenu}
              nested
              onHoverRow={onHoverRow}
              onKeepOpen={onKeepOpen}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

function selectionText(): string {
  return window.getSelection()?.toString() ?? "";
}

async function copySelection(): Promise<void> {
  focusEditor();
  const text = selectionText();
  if (!text) return;
  const copied = await copyText(text);
  if (!copied) useUiStore.getState().notify(t("toast.copyFailed"), "error");
}

async function cutSelection(): Promise<void> {
  focusEditor();
  const text = selectionText();
  if (!text) return;
  const copied = await copyText(text);
  if (!copied) {
    useUiStore.getState().notify(t("toast.copyFailed"), "error");
    return;
  }
  // Only remove the text once the clipboard actually holds it.
  document.execCommand("delete");
}

async function pasteIntoEditor(): Promise<void> {
  focusEditor();
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      insertText(text, text.length);
      return;
    }
  } catch {
    // Clipboard read is unavailable (no permission, or insecure context).
  }
  document.execCommand("paste");
}

async function openSearch(kind: "find" | "replace"): Promise<void> {
  const { openSearchPanel, findNext } = await import("@codemirror/search");
  focusEditor();
  runEditorCommand(openSearchPanel);
  if (kind === "replace") {
    // The panel shows the replace field as soon as it is open; nothing more to do.
    void findNext;
  }
}

async function quitApplication(): Promise<void> {
  // Closing the window is the single quit path: the shell listens for
  // `close-requested` and owns the save/session/confirmation flow.
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export const menuCommands = {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  toggleStrikethrough,
  toggleBulletList,
  toggleOrderedList,
};
