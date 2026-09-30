/** Transient interface state: dialogs, toasts and the resolved colour scheme. */

import { create } from "zustand";
import { nextId } from "@/shared/util";

export type DialogKind = "settings" | "about" | "shortcuts" | "externalChange" | "assetAccess";

export interface Toast {
  id: string;
  message: string;
  tone: "info" | "success" | "error";
  /** Optional single action rendered inside the toast. */
  action?: { label: string; run: () => void };
}

export type NotificationListener = (toast: Toast) => void;

interface UiState {
  /** Resolved appearance after applying the `system` preference. */
  appearance: "light" | "dark";
  dialog: DialogKind | null;
  toasts: Toast[];

  setAppearance: (appearance: "light" | "dark") => void;
  openDialog: (dialog: DialogKind) => void;
  closeDialog: () => void;
  notify: (message: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  dismiss: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  appearance: "light",
  dialog: null,
  toasts: [],

  setAppearance: (appearance) => set({ appearance }),

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  notify: (message, tone = "info", action) =>
    set((state) => {
      // Keep the toast list bounded so a burst of saves cannot pile up.
      const toasts = [...state.toasts, { id: nextId("toast"), message, tone, action }];
      return { toasts: toasts.slice(-4) };
    }),

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Convenience for non-React callers. */
export const notify = (message: string, tone: Toast["tone"] = "info", action?: Toast["action"]) =>
  useUiStore.getState().notify(message, tone, action);
