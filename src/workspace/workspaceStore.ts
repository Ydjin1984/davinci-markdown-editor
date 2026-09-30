/**
 * Explorer state.
 *
 * Directories are listed one level at a time and cached by path, so a workspace
 * with tens of thousands of files costs nothing until the user expands a node.
 */

import { create } from "zustand";
import * as ipc from "@/shared/ipc";
import { notify } from "@/app/uiStore";
import { t } from "@/shared/i18n";
import { basename, dirname, isMarkdownPath } from "@/shared/util";
import { settingsSnapshot } from "@/settings/settingsStore";
import type { DirEntry } from "@/shared/types";

interface WorkspaceState {
  root: string | null;
  children: Record<string, DirEntry[]>;
  expanded: string[];
  loading: string[];
  error: string | null;

  setRoot: (root: string | null) => Promise<void>;
  openFolderDialog: () => Promise<void>;
  closeFolder: () => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  refresh: (path: string) => Promise<void>;
  /** Refresh every loaded directory that contains the changed path. */
  invalidate: (path: string) => Promise<void>;
  collapseAll: () => void;
  isExpanded: (path: string) => boolean;
  /** Load the root plus the directories leading to `target`. */
  revealPath: (target: string) => Promise<void>;
}

function listOptions() {
  const settings = settingsSnapshot();
  return {
    includeIgnored: settings.files.showIgnored,
    extraIgnored: settings.files.extraIgnored,
  };
}

/** True when `child` is directly inside `parent`. */
function isDirectChild(parent: string, child: string): boolean {
  const normalise = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parentPath = normalise(parent);
  const childPath = normalise(child);
  if (!childPath.startsWith(`${parentPath}/`)) return false;
  return !childPath.slice(parentPath.length + 1).includes("/");
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  root: null,
  children: {},
  expanded: [],
  loading: [],
  error: null,

  setRoot: async (root) => {
    set({ root, children: {}, expanded: [], error: null });
    if (!root) {
      try {
        await ipc.closeWorkspace();
      } catch {
        // Closing a workspace that was never opened is not an error worth surfacing.
      }
      return;
    }
    await get().refresh(root);
  },

  openFolderDialog: async () => {
    const picked = await ipc.pickOpenDirectory();
    if (!picked) return;
    try {
      const root = await ipc.openWorkspace(picked);
      await get().setRoot(root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ipc.confirmDialog(t("error.openFolderTitle"), `${picked}\n\n${message}`, { kind: "error" });
    }
  },

  closeFolder: async () => {
    await get().setRoot(null);
  },

  toggleDirectory: async (path) => {
    const { expanded } = get();
    if (expanded.includes(path)) {
      set({ expanded: expanded.filter((item) => item !== path) });
      return;
    }
    set({ expanded: [...expanded, path] });
    if (!get().children[path]) {
      await get().refresh(path);
    }
  },

  refresh: async (path) => {
    set((state) => ({ loading: [...state.loading, path] }));
    try {
      const entries = await ipc.listDirectory(path, listOptions());
      set((state) => ({
        children: { ...state.children, [path]: entries },
        loading: state.loading.filter((item) => item !== path),
        error: null,
      }));
    } catch (error) {
      set((state) => ({
        loading: state.loading.filter((item) => item !== path),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },

  invalidate: async (path) => {
    // A change anywhere invalidates the listing of the directory that owns it;
    // a directory event also invalidates that directory itself.
    const { children } = get();
    const candidates = new Set<string>();

    for (const loaded of Object.keys(children)) {
      if (isDirectChild(loaded, path) || loaded === path) {
        candidates.add(loaded);
      }
    }

    const parent = dirname(path);
    if (children[parent]) candidates.add(parent);

    await Promise.all([...candidates].map((candidate) => get().refresh(candidate)));
  },

  collapseAll: () => set({ expanded: [] }),

  isExpanded: (path) => get().expanded.includes(path),

  revealPath: async (target) => {
    const root = get().root;
    if (!root) return;

    const normalise = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
    const rootPath = normalise(root);
    const targetPath = normalise(target);
    if (!targetPath.startsWith(rootPath)) return;

    const relative = targetPath.slice(rootPath.length).split("/").filter(Boolean);
    // Walk down to the parent directory, expanding as we go.
    let current = root;
    const toOpen: string[] = [];
    for (const segment of relative.slice(0, -1)) {
      current = `${current}/${segment}`;
      toOpen.push(current);
    }

    const expanded = new Set(get().expanded);
    for (const directory of toOpen) expanded.add(directory);
    set({ expanded: [...expanded] });

    for (const directory of toOpen) {
      if (!get().children[directory]) {
        await get().refresh(directory);
      }
    }
  },
}));

/** Every Markdown file currently visible in the tree, for quick-open style features. */
export function visibleMarkdownFiles(): string[] {
  const { children } = useWorkspaceStore.getState();
  const files: string[] = [];
  for (const entries of Object.values(children)) {
    for (const entry of entries) {
      if (!entry.isDir && isMarkdownPath(entry.path)) files.push(entry.path);
    }
  }
  return files;
}

export function fileName(path: string): string {
  return basename(path);
}

export { notify };
