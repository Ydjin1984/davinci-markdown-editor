/**
 * The only place the UI talks to Rust.
 *
 * Every command is wrapped so call sites get a typed signature and a normalised
 * error object instead of a raw rejection value.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppErrorPayload,
  AppInfo,
  DialogButtons,
  DialogKind,
  DirEntry,
  Eol,
  ExternalFileState,
  FsChangedPayload,
  FileFilterKind,
  LaunchPayload,
  ListOptions,
  PathInfo,
  Session,
  Settings,
  TextDocument,
  ThemeMode,
  WriteOptions,
} from "./types";

/** Event names shared with the Rust side. */
export const EVENTS = {
  openPaths: "app://open-paths",
  fsChanged: "fs://changed",
} as const;

/** Normalised failure raised by any command. */
export class IpcError extends Error {
  readonly code: AppErrorPayload["code"];
  readonly detail?: string;
  readonly path?: string;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = "IpcError";
    this.code = payload.code;
    this.detail = payload.detail;
    this.path = payload.path;
  }
}

function isAppError(value: unknown): value is AppErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppErrorPayload).code === "string" &&
    typeof (value as AppErrorPayload).message === "string"
  );
}

/** Run a command, converting any rejection into an {@link IpcError}. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (isAppError(raw)) {
      throw new IpcError(raw);
    }
    if (raw instanceof Error) {
      throw new IpcError({ code: "internal", message: raw.message, detail: raw.stack });
    }
    throw new IpcError({ code: "internal", message: String(raw) });
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export const takeLaunchPayload = () => call<LaunchPayload>("take_launch_payload");

export const notifyFrontendReady = () => call<void>("notify_frontend_ready");

export const showMainWindow = () => call<void>("show_main_window");

export const onOpenPaths = (handler: (payload: LaunchPayload) => void): Promise<UnlistenFn> =>
  listen<LaunchPayload>(EVENTS.openPaths, (event) => handler(event.payload));

export const onFsChanged = (handler: (payload: FsChangedPayload) => void): Promise<UnlistenFn> =>
  listen<FsChangedPayload>(EVENTS.fsChanged, (event) => handler(event.payload));

// ---------------------------------------------------------------------------
// Settings and session
// ---------------------------------------------------------------------------

export const getSettings = () => call<Settings>("get_settings");

export const updateSettings = (settings: Settings) => call<Settings>("update_settings", { settings });

export const resetSettings = () => call<Settings>("reset_settings");

export const getSession = () => call<Session>("get_session");

export const setSession = (session: Session) => call<void>("set_session", { session });

export const forgetRecentFile = (path: string) => call<Settings>("forget_recent_file", { path });

export const clearRecent = () => call<Settings>("clear_recent");

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const readDocument = (path: string) => call<TextDocument>("read_document", { path });

export const writeDocument = (path: string, content: string, options: WriteOptions = {}) =>
  call<TextDocument>("write_document", { path, content, options });

export const writeExportFile = (path: string, content: string) =>
  call<void>("write_export_file", { path, content });

export const statFile = (path: string) => call<ExternalFileState>("stat_file", { path });

export const closeDocument = (path: string) => call<void>("close_document", { path });

export const pathInfo = (path: string) => call<PathInfo>("path_info", { path });

export const resolveRelative = (path: string, base?: string | null) =>
  call<string>("resolve_relative", { path, base: base ?? null });

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const listDirectory = (path: string, options?: ListOptions) =>
  call<DirEntry[]>("list_directory", { path, options: options ?? null });

export const openWorkspace = (path: string) => call<string>("open_workspace", { path });

export const closeWorkspace = () => call<void>("close_workspace");

export const getWorkspace = () => call<string | null>("get_workspace");

export const createFile = (parent: string, name: string, content?: string) =>
  call<string>("create_file", { parent, name, content: content ?? null });

export const createDirectory = (parent: string, name: string) =>
  call<string>("create_directory", { parent, name });

export const renameEntry = (path: string, newName: string) =>
  call<[string, string]>("rename_entry", { path, newName });

export const deleteEntry = (path: string, permanent = false) =>
  call<void>("delete_entry", { path, permanent });

export const revealInFileManager = (path: string) => call<void>("reveal_in_file_manager", { path });

// ---------------------------------------------------------------------------
// Shell integration
// ---------------------------------------------------------------------------

export const openExternalUrl = (url: string) => call<void>("open_external_url", { url });

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export const pickOpenFiles = () => call<string[]>("pick_open_files");

export const pickOpenDirectory = () => call<string | null>("pick_open_directory");

export const pickSavePath = (
  defaultName?: string | null,
  kind: FileFilterKind = "markdown",
  startDir?: string | null,
) =>
  call<string | null>("pick_save_path", {
    defaultName: defaultName ?? null,
    kind,
    startDir: startDir ?? null,
  });

export interface ConfirmOptions {
  kind?: DialogKind;
  buttons?: DialogButtons;
  okLabel?: string;
  cancelLabel?: string;
}

export const confirmDialog = (title: string, message: string, options: ConfirmOptions = {}) =>
  call<boolean>("confirm_dialog", {
    kind: options.kind ?? "info",
    title,
    message,
    buttons: options.buttons ?? "ok",
    okLabel: options.okLabel ?? null,
    cancelLabel: options.cancelLabel ?? null,
  });

export type UnsavedAnswer = "save" | "discard" | "cancel";

/**
 * Three-way prompt for unsaved work.
 *
 * A two-button dialog cannot express "save, discard, or stay open", so closing a
 * dirty document uses this instead.
 */
export const promptUnsaved = (
  title: string,
  message: string,
  labels: { save?: string; discard?: string; cancel?: string } = {},
) =>
  call<UnsavedAnswer>("prompt_unsaved", {
    title,
    message,
    saveLabel: labels.save ?? null,
    discardLabel: labels.discard ?? null,
    cancelLabel: labels.cancel ?? null,
  });

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const appInfo = () => call<AppInfo>("app_info");

export const assetAccess = () => call<{ scheme: string; roots: string[] }>("asset_access");

export const markdownExtensions = () => call<string[]>("markdown_extensions");

// ---------------------------------------------------------------------------
// Window helpers (thin wrappers over the permitted core commands)
// ---------------------------------------------------------------------------

export { convertFileSrc } from "@tauri-apps/api/core";

export async function setWindowTitle(title: string): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

export type { Eol, Settings, TextDocument, ThemeMode };
