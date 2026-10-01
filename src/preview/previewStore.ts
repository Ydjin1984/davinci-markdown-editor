/**
 * Rendered preview output, shared between the preview pane and the outline.
 *
 * Rendering happens once per document change and feeds both consumers, so the
 * Markdown pipeline never runs twice for the same text.
 */

import { create } from "zustand";
import type { OutlineItem } from "@/shared/types";

interface PreviewState {
  html: string;
  outline: OutlineItem[];
  /** Document the current output belongs to. */
  documentId: string | null;
  /** True while a render for newer input is in flight. */
  pending: boolean;
  /** True while the diagrams in the current output are still being drawn. */
  diagramsPending: boolean;
  setRendered: (documentId: string, html: string, outline: OutlineItem[]) => void;
  setPending: (pending: boolean) => void;
  setDiagramsPending: (pending: boolean) => void;
  clear: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  html: "",
  outline: [],
  documentId: null,
  pending: false,
  diagramsPending: false,

  setRendered: (documentId, html, outline) => set({ documentId, html, outline, pending: false }),
  setPending: (pending) => set({ pending }),
  setDiagramsPending: (diagramsPending) => set({ diagramsPending }),
  clear: () => set({ html: "", outline: [], documentId: null, pending: false, diagramsPending: false }),
}));
