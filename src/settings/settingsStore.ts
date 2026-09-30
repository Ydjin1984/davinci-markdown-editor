/**
 * Settings, mirrored from the Rust-side `settings.json`.
 *
 * The store is the single source of truth for the UI; every mutation is written
 * back to disk through one debounced call so dragging a slider does not produce
 * a burst of file writes.
 */

import { create } from "zustand";
import * as ipc from "@/shared/ipc";
import { debounce } from "@/shared/util";
import { resolveLanguage, setLanguage } from "@/shared/i18n";
import type { LayoutMode, Settings } from "@/shared/types";
import type { ThemeMode } from "@/shared/types";

export const DEFAULT_SETTINGS: Settings = {
  editor: {
    fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.6,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: true,
    lineNumbers: true,
    highlightActiveLine: true,
    bracketMatching: true,
    codeFolding: true,
    showWhitespace: false,
    autosave: { enabled: false, delayMs: 1500, onFocusLost: true },
  },
  preview: {
    theme: "system",
    fontSize: 16,
    syncScroll: true,
    mermaidTheme: "auto",
    codeTheme: "auto",
    allowRawHtml: true,
    renderMath: true,
    lineWrapCode: false,
    openExternalLinks: true,
    headingAnchors: false,
  },
  files: {
    restoreSession: true,
    recentFiles: [],
    recentWorkspaces: [],
    externalChange: "ask",
    defaultEol: "lf",
    defaultEncoding: "UTF-8",
    showIgnored: false,
    extraIgnored: [],
    confirmDelete: true,
  },
  application: { theme: "system", zoom: 1, language: "system", telemetry: false },
  view: {
    layout: "split-v",
    splitRatio: 0.5,
    showExplorer: true,
    showOutline: false,
    explorerWidth: 260,
    outlineWidth: 240,
  },
};

type Section = keyof Settings;

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  /** Patch one section, persisting the result. */
  patch: <K extends Section>(section: K, values: Partial<Settings[K]>) => void;
  replace: (settings: Settings) => void;
  reset: () => Promise<void>;
}

const persist = debounce((settings: Settings) => {
  void ipc.updateSettings(settings).catch((error) => {
    console.error("Saving settings failed", error);
  });
}, 400);

function applySideEffects(settings: Settings): void {
  setLanguage(resolveLanguage(settings.application.language));

  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--app-zoom", String(settings.application.zoom));
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  error: null,

  load: async () => {
    try {
      const settings = await ipc.getSettings();
      applySideEffects(settings);
      set({ settings, loaded: true, error: null });
    } catch (error) {
      // A failed load must not block the application: defaults are usable.
      console.error("Loading settings failed, using defaults", error);
      set({ settings: DEFAULT_SETTINGS, loaded: true, error: String(error) });
    }
  },

  patch: (section, values) => {
    const current = get().settings;
    const next: Settings = {
      ...current,
      [section]: { ...current[section], ...values },
    } as Settings;
    applySideEffects(next);
    set({ settings: next });
    persist(next);
  },

  replace: (settings) => {
    applySideEffects(settings);
    set({ settings });
    persist(settings);
  },

  reset: async () => {
    const settings = await ipc.resetSettings();
    applySideEffects(settings);
    set({ settings });
  },
}));

/** Read settings outside of React. */
export const settingsSnapshot = (): Settings => useSettingsStore.getState().settings;

export const layoutMode = (): LayoutMode => useSettingsStore.getState().settings.view.layout;

export const prefersDark = (theme: ThemeMode): boolean => {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
};
