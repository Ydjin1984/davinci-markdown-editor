/**
 * Application shell: layout, lifecycle and the wiring between the stores, the
 * filesystem watcher and the operating-system hand-off.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MenuBar } from "@/app/MenuBar";
import { StatusBar } from "@/app/StatusBar";
import { Toasts } from "@/app/Toasts";
import { AboutDialog, AssetAccessDialog, ShortcutsDialog } from "@/app/Dialogs";
import { useUiStore } from "@/app/uiStore";
import { EditorPane } from "@/editor/EditorPane";
import { focusEditor } from "@/editor/editorApi";
import { Outline } from "@/outline/Outline";
import { Explorer } from "@/explorer/Explorer";
import { PreviewPane } from "@/preview/PreviewPane";
import { useMarkdownRender } from "@/preview/useMarkdownRender";
import { usePreviewStore } from "@/preview/previewStore";
import { useSettingsStore } from "@/settings/settingsStore";
import { SettingsDialog } from "@/settings/SettingsDialog";
import { TabBar } from "@/tabs/TabBar";
import { dirtyDocuments, useDocumentsStore } from "@/tabs/documentsStore";
import { useWorkspaceStore } from "@/workspace/workspaceStore";
import * as ipc from "@/shared/ipc";
import { t } from "@/shared/i18n";
import { clamp, cx, debounce } from "@/shared/util";
import type { LayoutMode, Session } from "@/shared/types";

/** Delay before the session is written after the last change. */
const SESSION_SAVE_MS = 800;

export function App() {
  const settings = useSettingsStore((state) => state.settings);
  const loadSettings = useSettingsStore((state) => state.load);
  const patch = useSettingsStore((state) => state.patch);

  const dialog = useUiStore((state) => state.dialog);
  const closeDialog = useUiStore((state) => state.closeDialog);
  const setAppearance = useUiStore((state) => state.setAppearance);

  const documents = useDocumentsStore((state) => state.documents);
  const activeDocument = useDocumentsStore(
    (state) => state.documents.find((item) => item.id === state.activeId) ?? null,
  );
  const activeId = activeDocument?.id ?? null;

  const [ready, setReady] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // --- settings -----------------------------------------------------------

  useEffect(() => {
    void loadSettings().then(() => setReady(true));
  }, [loadSettings]);

  // --- colour scheme ------------------------------------------------------

  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolve = () => {
      const preference = settings.application.theme;
      const dark = preference === "dark" || (preference === "system" && media.matches);
      const next = dark ? "dark" : "light";
      setAppearance(next);
      document.documentElement.dataset.appearance = next;
    };
    resolve();
    // Following the OS only matters while the preference is "system".
    if (settings.application.theme !== "system") return;
    media.addEventListener("change", resolve);
    return () => media.removeEventListener("change", resolve);
  }, [settings.application.theme, ready, setAppearance]);

  // --- live preview -------------------------------------------------------

  const renderOptions = useMemo(
    () => ({
      allowRawHtml: settings.preview.allowRawHtml,
      renderMath: settings.preview.renderMath,
      headingAnchors: settings.preview.headingAnchors,
      documentDir: activeDocument?.path ? activeDocument.path.replace(/[\\/][^\\/]*$/, "") : null,
      appearance: useUiStore.getState().appearance,
      codeTheme: settings.preview.codeTheme,
      lineWrapCode: settings.preview.lineWrapCode,
    }),
    // The whole record is listed rather than `activeDocument?.path` so the
    // inferred and declared dependencies agree; downstream consumers compare the
    // individual fields, so a new identity per keystroke costs nothing.
    [settings.preview, activeDocument],
  );

  const appearance = useUiStore((state) => state.appearance);
  const printing = useUiStore((state) => state.printing);

  useMarkdownRender({
    documentId: activeId,
    content: activeDocument?.content ?? "",
    // Printing always renders with the light theme: a dark preview would put
    // near-white text on white paper as soon as background graphics are off.
    render: { ...renderOptions, appearance: printing ? "light" : appearance },
    enabled: ready && activeId !== null,
  });

  // --- startup hand-off ---------------------------------------------------

  const readyRef = useRef(false);

  useEffect(() => {
    if (!ready) return;

    const openWorkspaceRoot = async (workspace: string) => {
      const root = await ipc.openWorkspace(workspace);
      await useWorkspaceStore.getState().setRoot(root);
    };

    const openPayload = async (files: string[], workspace: string | null) => {
      if (workspace) await openWorkspaceRoot(workspace);
      if (files.length > 0) await useDocumentsStore.getState().openPaths(files);
    };

    /**
     * Decide what to show at startup.
     *
     * Paths handed over by the OS always win. Only what the OS did not specify
     * falls back to the previous session, and only when the user asked for that.
     */
    const bootstrap = async () => {
      try {
        const payload = await ipc.takeLaunchPayload();
        const session = settings.files.restoreSession ? await ipc.getSession() : null;

        if (payload.workspace) {
          await openWorkspaceRoot(payload.workspace);
        } else if (session?.workspaceRoot) {
          await openWorkspaceRoot(session.workspaceRoot);
        }

        if (payload.files.length > 0) {
          await useDocumentsStore.getState().openPaths(payload.files);
        } else if (session && session.documents.length > 0) {
          await restoreSessionDocuments(session);
        } else {
          useDocumentsStore.getState().createUntitled();
        }
      } catch (error) {
        console.error("Startup failed", error);
      } finally {
        // The window is only revealed once there is something to show, so a
        // double-click never flashes an empty window.
        await ipc.notifyFrontendReady();
        readyRef.current = true;
      }
    };

    void bootstrap();

    const disposers: Array<() => void> = [];

    void ipc
      .onOpenPaths((payload) => {
        void openPayload(payload.files, payload.workspace);
      })
      .then((unlisten) => disposers.push(unlisten));

    void ipc
      .onFsChanged((payload) => {
        useDocumentsStore.getState().applyFsChanges(payload.changes);

        for (const change of payload.changes) {
          if (change.kind === "removed") continue;
          void useWorkspaceStore.getState().invalidate(change.path);
        }

        // A creation or rename inside the workspace should make the new file
        // visible without a manual refresh.
        for (const change of payload.changes) {
          if (change.kind === "created") void useWorkspaceStore.getState().invalidate(change.path);
        }
      })
      .then((unlisten) => disposers.push(unlisten));

    // Only the event subscriptions are torn down. The session is deliberately
    // left on disk: unmounting must not erase what the next launch restores.
    return () => {
      for (const dispose of disposers) dispose();
    };
    // Runs once, after settings are loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // --- external change policy --------------------------------------------

  /** Documents already waiting on an answer, so prompts cannot stack up. */
  const resolving = useRef(new Set<string>());

  useEffect(() => {
    if (!ready) return;

    for (const document of documents) {
      if (document.external === "none") continue;

      if (settings.files.externalChange === "autoReload") {
        void useDocumentsStore.getState().resolveExternal(document.id, "reload");
        continue;
      }
      if (settings.files.externalChange === "keepLocal") {
        void useDocumentsStore.getState().resolveExternal(document.id, "keep");
        continue;
      }

      // "ask": a clean document reloads silently; one with unsaved work asks,
      // so local edits are never discarded without consent.
      if (!document.dirty) {
        void useDocumentsStore.getState().resolveExternal(document.id, "reload");
        continue;
      }

      if (resolving.current.has(document.id)) continue;
      resolving.current.add(document.id);

      void (async () => {
        try {
          const reload = await ipc.confirmDialog(
            t("dialog.externalTitle"),
            t("dialog.externalBody", { name: document.title }),
            {
              kind: "warning",
              buttons: "okCancel",
              okLabel: t("dialog.reload"),
              cancelLabel: t("dialog.keepLocal"),
            },
          );
          await useDocumentsStore.getState().resolveExternal(document.id, reload ? "reload" : "keep");
        } finally {
          resolving.current.delete(document.id);
        }
      })();
    }
  }, [documents, settings.files.externalChange, ready]);

  // --- autosave -----------------------------------------------------------

  useEffect(() => {
    if (!ready || !settings.editor.autosave.enabled) return;

    const timer = setTimeout(() => {
      const dirty = dirtyDocuments().filter((document) => document.path !== null);
      if (dirty.length === 0) return;
      for (const document of dirty) void useDocumentsStore.getState().save(document.id);
    }, settings.editor.autosave.delayMs);

    return () => clearTimeout(timer);
  }, [documents, settings.editor.autosave, ready]);

  useEffect(() => {
    if (!ready || !settings.editor.autosave.enabled || !settings.editor.autosave.onFocusLost) return;
    const handler = () => {
      if (document.visibilityState !== "hidden") return;
      for (const document of dirtyDocuments().filter((item) => item.path !== null)) {
        void useDocumentsStore.getState().save(document.id);
      }
    };
    window.addEventListener("blur", handler);
    document.addEventListener("visibilitychange", handler);
    return () => {
      window.removeEventListener("blur", handler);
      document.removeEventListener("visibilitychange", handler);
    };
  }, [settings.editor.autosave, ready]);

  // --- session persistence ------------------------------------------------

  const persistSession = useMemo(() => debounce(() => void writeSession(), SESSION_SAVE_MS), []);

  useEffect(() => {
    if (!ready || !settings.files.restoreSession) return;
    persistSession();
  }, [documents, settings.files.restoreSession, ready, persistSession]);

  // --- unsaved work on quit ----------------------------------------------

  useEffect(() => {
    if (!ready) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const current = getCurrentWindow();

      // Shared by the window close request and the macOS application menu's
      // Quit item. Saving and confirming first, then destroying the window —
      // destroying the last window ends the process.
      const runExitFlow = async () => {
        // Save everything that can be saved without asking.
        for (const document of dirtyDocuments()) {
          if (!document.path) continue; // Untitled documents need a decision.
          await useDocumentsStore.getState().save(document.id);
        }

        const remaining = dirtyDocuments();
        if (remaining.length > 0) {
          const discard = await ipc.confirmDialog(
            t("dialog.unsavedTitle"),
            t("dialog.unsavedQuitBody", { count: remaining.length }),
            {
              kind: "warning",
              buttons: "okCancel",
              okLabel: t("dialog.dontSave"),
              cancelLabel: t("common.cancel"),
            },
          );
          if (!discard) return;
        }

        await writeSession();
        await current.destroy();
      };

      const unlistenClose = await current.onCloseRequested(async (event) => {
        if (dirtyDocuments().length === 0) {
          await writeSession();
          return;
        }
        event.preventDefault();
        await runExitFlow();
      });

      // The macOS menu's Quit item emits this event instead of terminating
      // the process, so unsaved work gets the same prompt as ⌘W.
      const unlistenQuit = await ipc.onQuitRequested(() => {
        void runExitFlow();
      });

      if (cancelled) {
        unlistenClose();
        unlistenQuit();
      } else {
        dispose = () => {
          unlistenClose();
          unlistenQuit();
        };
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [ready]);

  // --- global shortcuts ---------------------------------------------------

  useEffect(() => {
    if (!ready) return;

    const handler = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) {
        if (event.key === "Escape" && useUiStore.getState().dialog) {
          event.preventDefault();
          closeDialog();
        }
        return;
      }

      const key = event.key.toLowerCase();
      const store = useDocumentsStore.getState();

      const consume = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };

      switch (key) {
        case "s":
          consume(() => {
            const id = store.activeId;
            if (!id) return;
            if (event.shiftKey) void store.save(id, { saveAs: true });
            else void store.save(id);
          });
          break;
        case "o":
          consume(() => {
            if (event.shiftKey) void useWorkspaceStore.getState().openFolderDialog();
            else void ipc.pickOpenFiles().then((paths) => store.openPaths(paths));
          });
          break;
        case "n":
          consume(() => store.createUntitled());
          break;
        case "w":
          consume(() => {
            const id = store.activeId;
            if (id) void store.requestClose(id);
          });
          break;
        case ",":
          consume(() => useUiStore.getState().openDialog("settings"));
          break;
        case "tab":
          consume(() => {
            const index = store.documents.findIndex((document) => document.id === store.activeId);
            if (index === -1) return;
            const delta = event.shiftKey ? -1 : 1;
            const next = (index + delta + store.documents.length) % store.documents.length;
            store.activate(store.documents[next]!.id);
          });
          break;
        case "f":
          // CodeMirror handles this when the editor has focus; otherwise give
          // focus back and open the panel there.
          if (event.shiftKey) return;
          consume(() => {
            focusEditor();
            void import("@codemirror/search").then((module) => {
              void import("@/editor/editorApi").then((api) => api.runEditorCommand(module.openSearchPanel));
            });
          });
          break;
        case "h":
          consume(() => {
            focusEditor();
            void import("@codemirror/search").then((module) => {
              void import("@/editor/editorApi").then((api) => api.runEditorCommand(module.openSearchPanel));
            });
          });
          break;
        case "p":
          // The conventional shortcut for "make a document out of this".
          consume(() => {
            void import("@/preview/exportActions").then((module) => module.printDocument());
          });
          break;
        case "e":
          if (!event.shiftKey) return;
          consume(() => {
            void import("@/preview/exportActions").then((module) => module.exportHtml());
          });
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [ready, closeDialog]);

  // --- split resizing -----------------------------------------------------

  const layout: LayoutMode = settings.view.layout;
  const isHorizontalSplit = layout === "split-h";

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = splitContainerRef.current;
      if (!container) return;
      setDragging(true);

      const rect = container.getBoundingClientRect();
      const move = (moveEvent: PointerEvent) => {
        const ratio = isHorizontalSplit
          ? (moveEvent.clientY - rect.top) / rect.height
          : (moveEvent.clientX - rect.left) / rect.width;
        patch("view", { splitRatio: clamp(ratio, 0.15, 0.85) });
      };
      const stop = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [isHorizontalSplit, patch],
  );

  const showEditor = layout !== "preview" && !printing;
  // Printing reads the preview, so it has to be mounted even in editor-only mode.
  const showPreview = layout !== "editor" || printing;

  return (
    <div className="app-shell" data-layout={layout}>
      <MenuBar />
      <TabBar />

      <div className="app-workspace">
        {settings.view.showExplorer && (
          <aside className="sidebar sidebar--left" style={{ width: settings.view.explorerWidth }}>
            <Explorer />
          </aside>
        )}

        <div
          className={cx(
            "app-panes",
            isHorizontalSplit ? "is-horizontal" : "is-vertical",
            dragging && "is-dragging",
          )}
          ref={splitContainerRef}
        >
          {showEditor && (
            <section
              className="pane pane--editor"
              style={
                showPreview
                  ? isHorizontalSplit
                    ? { height: `${settings.view.splitRatio * 100}%` }
                    : { width: `${settings.view.splitRatio * 100}%` }
                  : undefined
              }
            >
              <EditorPane
                onTogglePreview={() => {
                  // Read the layout fresh: inside this branch TypeScript has
                  // already narrowed the local `layout` constant.
                  const current = useSettingsStore.getState().settings.view.layout;
                  patch("view", { layout: current === "preview" ? "editor" : "preview" });
                }}
              />
            </section>
          )}

          {showEditor && showPreview && (
            <div
              className={cx("splitter", isHorizontalSplit ? "splitter--horizontal" : "splitter--vertical")}
              onPointerDown={startResize}
              role="separator"
              aria-orientation={isHorizontalSplit ? "horizontal" : "vertical"}
            />
          )}

          {showPreview && (
            <section className="pane pane--preview">
              <PreviewPane />
            </section>
          )}
        </div>

        {settings.view.showOutline && (
          <aside className="sidebar sidebar--right" style={{ width: settings.view.outlineWidth }}>
            {/* Remounting per document resets the expansion state, which is
                exactly what `key` is for. */}
            <Outline key={activeId ?? "none"} />
          </aside>
        )}
      </div>

      <StatusBar />
      <Toasts />

      {dialog && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            // About carries the publisher details and a donation QR, so it needs
            // the same room as the settings pane.
            className={cx("modal", (dialog === "settings" || dialog === "about") && "modal--wide")}
            role="dialog"
            aria-modal="true"
          >
            <header className="modal-header">
              <h2>
                {dialog === "settings" && t("settings.title")}
                {dialog === "about" && t("help.about")}
                {dialog === "shortcuts" && t("help.keyboard")}
                {dialog === "assetAccess" && t("tools.assetRoots")}
                {dialog === "externalChange" && t("dialog.externalTitle")}
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeDialog}
                aria-label={t("common.cancel")}
              >
                ✕
              </button>
            </header>

            <div className="modal-content">
              {dialog === "settings" && <SettingsDialog />}
              {dialog === "about" && <AboutDialog />}
              {dialog === "shortcuts" && <ShortcutsDialog />}
              {dialog === "assetAccess" && <AssetAccessDialog />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Write the current session to disk.
 *
 * Called on a debounce while editing, and unconditionally right before the
 * window closes so the very last state survives.
 */
async function writeSession(): Promise<void> {
  const state = useDocumentsStore.getState();
  const session: Session = {
    documents: state.documents
      .filter((document) => document.path !== null)
      .map((document) => ({
        path: document.path!,
        cursorLine: document.cursorLine,
        cursorCol: document.cursorCol,
        scrollTop: document.scrollTop,
      })),
    activeIndex: Math.max(
      state.documents.findIndex((document) => document.id === state.activeId),
      0,
    ),
    workspaceRoot: useWorkspaceStore.getState().root,
  };
  try {
    await ipc.setSession(session);
  } catch {
    // Losing the session record is not worth interrupting the user over.
  }
}

/** Reopen the documents recorded in a previous session. */
async function restoreSessionDocuments(session: Session): Promise<void> {
  const paths = session.documents.map((document) => document.path);
  if (paths.length === 0) {
    useDocumentsStore.getState().createUntitled();
    return;
  }

  await useDocumentsStore.getState().openPaths(paths, { silent: true });

  const documents = useDocumentsStore.getState().documents;
  const active = documents[Math.min(Math.max(session.activeIndex, 0), documents.length - 1)];
  if (active) useDocumentsStore.getState().activate(active.id);
}

export { usePreviewStore };
