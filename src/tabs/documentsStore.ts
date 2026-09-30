/**
 * Open documents and tab management.
 *
 * The store owns the persisted view of a document (content, encoding, dirty
 * state). CodeMirror owns the live text while a tab is on screen; the two are
 * reconciled on save, on tab switch and on a short debounce after typing.
 */

import { create } from "zustand";
import * as ipc from "@/shared/ipc";
import { IpcError } from "@/shared/ipc";
import { notify } from "@/app/uiStore";
import { t } from "@/shared/i18n";
import { basename, nextId, stem } from "@/shared/util";
import { settingsSnapshot } from "@/settings/settingsStore";
import type { Eol, FsChange, TextDocument } from "@/shared/types";

export type ExternalState = "none" | "changed" | "removed";

export interface DocumentRecord {
  id: string;
  path: string | null;
  title: string;
  /** In-memory text, always LF-normalised. */
  content: string;
  /** Text as it exists on disk; drives the dirty indicator exactly. */
  savedContent: string;
  encoding: string;
  eol: Eol;
  bom: boolean;
  readOnly: boolean;
  dirty: boolean;
  /** Hash of the on-disk content the editor last read or wrote. */
  baseHash: string | null;
  external: ExternalState;
  cursorLine: number;
  cursorCol: number;
  scrollTop: number;
  /**
   * Incremented whenever `content` is replaced from outside the editor
   * (reload from disk, discarding external changes). The editor watches this to
   * know when it must replace its buffer instead of ignoring the update as an
   * echo of its own typing.
   */
  contentEpoch: number;
}

interface DocumentsState {
  documents: DocumentRecord[];
  activeId: string | null;
  /** Stack of recently closed documents, newest last. */
  closed: Array<{ path: string | null; content: string; title: string }>;

  activeDocument: () => DocumentRecord | null;
  byPath: (path: string) => DocumentRecord | undefined;

  openPaths: (paths: string[], options?: { silent?: boolean }) => Promise<void>;
  createUntitled: (content?: string) => string;
  activate: (id: string) => void;
  reorder: (fromIndex: number, toIndex: number) => void;

  /** Flag a document as edited without paying for a content copy. */
  touch: (id: string) => void;
  setContent: (id: string, content: string) => void;
  setCursorAt: (id: string, line: number, col: number, scrollTop: number) => void;

  save: (id: string, options?: { saveAs?: boolean }) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  reload: (id: string) => Promise<void>;

  requestClose: (id: string) => Promise<boolean>;
  closeOthers: (id: string) => Promise<void>;
  closeAll: () => Promise<boolean>;
  reopenClosed: () => void;

  applyFsChanges: (changes: FsChange[]) => void;
  resolveExternal: (id: string, action: "reload" | "keep") => Promise<void>;
  handlePathRenamed: (from: string, to: string) => void;
}

function recordFrom(document: TextDocument): DocumentRecord {
  return {
    id: nextId("doc"),
    path: document.path,
    title: document.name,
    content: document.content,
    savedContent: document.content,
    encoding: document.encoding,
    eol: document.eol,
    bom: document.bom,
    readOnly: document.readOnly,
    dirty: false,
    baseHash: document.hash,
    external: "none",
    cursorLine: 1,
    cursorCol: 1,
    scrollTop: 0,
    contentEpoch: 0,
  };
}

function untitledRecord(content: string, index: number): DocumentRecord {
  const settings = settingsSnapshot();
  return {
    id: nextId("doc"),
    path: null,
    title: index === 0 ? t("app.untitled") : `${t("app.untitled")} ${index + 1}`,
    content,
    savedContent: "",
    encoding: settings.files.defaultEncoding === "auto" ? "UTF-8" : settings.files.defaultEncoding,
    eol: settings.files.defaultEol === "crlf" ? "crlf" : "lf",
    bom: false,
    readOnly: false,
    dirty: content.length > 0,
    baseHash: null,
    external: "none",
    cursorLine: 1,
    cursorCol: 1,
    scrollTop: 0,
    contentEpoch: 0,
  };
}

function isSamePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

function update(documents: DocumentRecord[], id: string, patch: Partial<DocumentRecord>): DocumentRecord[] {
  return documents.map((document) => (document.id === id ? { ...document, ...patch } : document));
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  documents: [],
  activeId: null,
  closed: [],

  activeDocument: () => {
    const { documents, activeId } = get();
    return documents.find((document) => document.id === activeId) ?? null;
  },

  byPath: (path) => get().documents.find((document) => isSamePath(document.path, path)),

  openPaths: async (paths, options) => {
    for (const path of paths) {
      const existing = get().documents.find((document) => isSamePath(document.path, path));
      if (existing) {
        set({ activeId: existing.id });
        continue;
      }

      try {
        const document = await ipc.readDocument(path);
        const record = recordFrom(document);
        set((state) => ({
          documents: [...state.documents, record],
          activeId: record.id,
        }));
      } catch (error) {
        if (options?.silent) continue;
        const failure = error instanceof IpcError ? error : null;
        await ipc.confirmDialog(t("error.openTitle"), `${path}\n\n${failure?.message ?? String(error)}`, {
          kind: "error",
        });
      }
    }
  },

  createUntitled: (content = "") => {
    const record = untitledRecord(content, get().documents.filter((d) => d.path === null).length);
    set((state) => ({ documents: [...state.documents, record], activeId: record.id }));
    return record.id;
  },

  activate: (id) => set({ activeId: id }),

  reorder: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return state;
      const documents = [...state.documents];
      const [moved] = documents.splice(fromIndex, 1);
      if (!moved) return state;
      documents.splice(toIndex, 0, moved);
      return { documents };
    }),

  touch: (id) =>
    set((state) => {
      const document = state.documents.find((item) => item.id === id);
      if (!document || document.dirty) return state;
      return { documents: update(state.documents, id, { dirty: true }) };
    }),

  setContent: (id, content) =>
    set((state) => {
      const document = state.documents.find((item) => item.id === id);
      if (!document) return state;
      const dirty = content !== document.savedContent;
      if (document.content === content && document.dirty === dirty) return state;
      return { documents: update(state.documents, id, { content, dirty }) };
    }),

  setCursorAt: (id, cursorLine, cursorCol, scrollTop) =>
    set((state) => {
      const document = state.documents.find((item) => item.id === id);
      if (
        !document ||
        (document.cursorLine === cursorLine &&
          document.cursorCol === cursorCol &&
          Math.abs(document.scrollTop - scrollTop) < 1)
      ) {
        return state;
      }
      return { documents: update(state.documents, id, { cursorLine, cursorCol, scrollTop }) };
    }),

  save: async (id, options) => {
    const document = get().documents.find((item) => item.id === id);
    if (!document) return false;

    let target = document.path;

    if (!target || options?.saveAs) {
      const suggested = target ? basename(target) : `${stem(document.title)}.md`;
      const startDir = target ? null : null;
      const picked = await ipc.pickSavePath(suggested, "markdown", startDir);
      if (!picked) return false;
      target = picked;
    }

    const write = async (expectedHash: string | null): Promise<TextDocument | null> => {
      try {
        return await ipc.writeDocument(target!, document.content, {
          encoding: document.encoding,
          eol: document.eol,
          bom: document.bom,
          expectedHash,
        });
      } catch (error) {
        if (error instanceof IpcError && error.code === "conflict") {
          const overwrite = await ipc.confirmDialog(
            t("error.conflictTitle"),
            `${t("error.conflictBody", { name: basename(target!) })}\n\n${target}`,
            {
              kind: "warning",
              buttons: "okCancel",
              okLabel: t("error.overwrite"),
              cancelLabel: t("error.saveACopy"),
            },
          );
          if (overwrite) {
            return write(null);
          }
          const copy = await ipc.pickSavePath(`copy-of-${basename(target!)}`, "markdown", null);
          if (!copy) return null;
          try {
            return await ipc.writeDocument(copy, document.content, {
              encoding: document.encoding,
              eol: document.eol,
              bom: document.bom,
            });
          } catch (copyError) {
            await ipc.confirmDialog(t("error.saveTitle"), describe(copyError), { kind: "error" });
            return null;
          }
        }
        await ipc.confirmDialog(t("error.saveTitle"), describe(error), { kind: "error" });
        return null;
      }
    };

    const saved = await write(document.baseHash);
    if (!saved) return false;

    // A Save As can move the document to a different path; release the old one.
    if (document.path && !isSamePath(document.path, saved.path)) {
      void ipc.closeDocument(document.path).catch(() => undefined);
    }

    set((state) => ({
      documents: update(state.documents, id, {
        path: saved.path,
        title: saved.name,
        // `content` is left alone: the user may have typed while the write was
        // in flight, and only `savedContent` should move forward.
        savedContent: saved.content,
        encoding: saved.encoding,
        eol: saved.eol,
        bom: saved.bom,
        readOnly: saved.readOnly,
        dirty: document.content !== saved.content,
        baseHash: saved.hash,
        external: "none",
      }),
    }));

    notify(t("toast.saved", { name: saved.name }), "success");
    return true;
  },

  saveAll: async () => {
    const dirty = get().documents.filter((document) => document.dirty);
    let allSaved = true;
    for (const document of dirty) {
      const saved = await get().save(document.id);
      if (!saved) allSaved = false;
    }
    return allSaved;
  },

  reload: async (id) => {
    const document = get().documents.find((item) => item.id === id);
    if (!document?.path) return;
    try {
      const fresh = await ipc.readDocument(document.path);
      set((state) => ({
        documents: update(state.documents, id, {
          content: fresh.content,
          savedContent: fresh.content,
          encoding: fresh.encoding,
          eol: fresh.eol,
          bom: fresh.bom,
          readOnly: fresh.readOnly,
          dirty: false,
          baseHash: fresh.hash,
          external: "none",
          contentEpoch: document.contentEpoch + 1,
        }),
      }));
    } catch (error) {
      await ipc.confirmDialog(t("error.openTitle"), describe(error), { kind: "error" });
    }
  },

  requestClose: async (id) => {
    const document = get().documents.find((item) => item.id === id);
    if (!document) return true;

    if (document.dirty) {
      // Three outcomes, not two: the user must be able to back out of closing
      // the tab entirely without either saving or discarding.
      const answer = await ipc.promptUnsaved(
        t("dialog.unsavedTitle"),
        t("dialog.unsavedBody", { name: document.title }),
        {
          save: t("dialog.save"),
          discard: t("dialog.dontSave"),
          cancel: t("common.cancel"),
        },
      );

      if (answer === "cancel") return false;
      if (answer === "save") {
        const saved = await get().save(id);
        // A cancelled Save As dialog also aborts the close.
        if (!saved) return false;
      }
    }

    if (document.path) {
      void ipc.closeDocument(document.path).catch(() => undefined);
    }

    set((state) => {
      const documents = state.documents.filter((item) => item.id !== id);
      const index = state.documents.findIndex((item) => item.id === id);
      const nextActive =
        state.activeId === id
          ? (documents[Math.min(index, documents.length - 1)]?.id ?? null)
          : state.activeId;
      return {
        documents,
        activeId: nextActive,
        closed: [
          ...state.closed.slice(-19),
          { path: document.path, content: document.content, title: document.title },
        ],
      };
    });

    return true;
  },

  closeOthers: async (id) => {
    const others = get().documents.filter((document) => document.id !== id);
    for (const document of others) {
      const closed = await get().requestClose(document.id);
      if (!closed) return;
    }
    set({ activeId: id });
  },

  closeAll: async () => {
    const documents = [...get().documents];
    for (const document of documents) {
      const closed = await get().requestClose(document.id);
      if (!closed) return false;
    }
    return true;
  },

  reopenClosed: () => {
    const { closed } = get();
    const entry = closed[closed.length - 1];
    if (!entry) return;
    set({ closed: closed.slice(0, -1) });

    if (entry.path) {
      void get().openPaths([entry.path]);
    } else {
      const record = untitledRecord(entry.content, get().documents.filter((d) => d.path === null).length);
      set((state) => ({ documents: [...state.documents, record], activeId: record.id }));
    }
  },

  applyFsChanges: (changes) => {
    // Renames and deletions are unambiguous and applied immediately.
    const renames = changes.filter((change) => change.kind === "renamed" && change.to);
    const removals = changes.filter((change) => change.kind === "removed");

    set((state) => {
      let documents = state.documents;

      for (const change of renames) {
        documents = documents.map((document) =>
          isSamePath(document.path, change.path)
            ? { ...document, path: change.to!, title: basename(change.to!) }
            : document,
        );
      }

      for (const change of removals) {
        const match = documents.find((document) => isSamePath(document.path, change.path));
        if (match) documents = update(documents, match.id, { external: "removed" });
      }

      return { documents };
    });

    // Modified/created events need a hash comparison before we raise a warning:
    // an identical rewrite (or a timestamp-only touch) is not a real change.
    const candidates = changes.filter((change) => change.kind !== "removed" && change.kind !== "renamed");
    for (const change of candidates) {
      const match = get().documents.find((document) => isSamePath(document.path, change.path));
      if (!match || match.external === "changed") continue;

      void (async () => {
        try {
          const disk = await ipc.statFile(change.path);
          if (!disk.exists) return;
          const current = get().documents.find((document) => document.id === match.id);
          if (!current || current.external === "changed") return;
          // The editor's own writes are filtered in Rust; anything that reaches
          // here with a matching hash is a no-op rewrite.
          if (disk.hash === current.baseHash) return;
          set((state) => ({ documents: update(state.documents, match.id, { external: "changed" }) }));
        } catch {
          // A file that vanished between the event and the check is handled by
          // the removal path on the next event.
        }
      })();
    }
  },

  resolveExternal: async (id, action) => {
    if (action === "reload") {
      await get().reload(id);
      return;
    }

    // Keep the local text but adopt what is on disk as the new base, so the
    // next explicit save is allowed to overwrite it.
    const document = get().documents.find((item) => item.id === id);
    if (!document?.path) {
      set((state) => ({ documents: update(state.documents, id, { external: "none" }) }));
      return;
    }

    try {
      const disk = await ipc.statFile(document.path);
      set((state) => ({
        documents: update(state.documents, id, { external: "none", baseHash: disk.hash }),
      }));
    } catch {
      set((state) => ({ documents: update(state.documents, id, { external: "none" }) }));
    }
  },

  handlePathRenamed: (from, to) => {
    set((state) => ({
      documents: state.documents.map((document) =>
        isSamePath(document.path, from) ? { ...document, path: to, title: basename(to) } : document,
      ),
    }));
  },
}));

function describe(error: unknown): string {
  if (error instanceof IpcError) return error.message;
  return String(error);
}

/** Documents that would lose data if the application quit right now. */
export const dirtyDocuments = (): DocumentRecord[] =>
  useDocumentsStore.getState().documents.filter((document) => document.dirty);
