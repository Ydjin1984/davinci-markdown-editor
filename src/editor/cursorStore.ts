/**
 * Caret and scroll positions, kept out of the documents store.
 *
 * The caret moves on every keystroke; storing it alongside the document would
 * re-render every tab and sidebar on each key press. Keeping it in its own store
 * means only the status bar and the scroll-sync code subscribe to it.
 */

import { create } from "zustand";

export interface CursorPosition {
  line: number;
  col: number;
  selectionLength: number;
  scrollTop: number;
}

const EMPTY: CursorPosition = { line: 1, col: 1, selectionLength: 0, scrollTop: 0 };

interface CursorState {
  positions: Record<string, CursorPosition>;
  set: (documentId: string, position: CursorPosition) => void;
  forget: (documentId: string) => void;
}

export const useCursorStore = create<CursorState>((set) => ({
  positions: {},

  set: (documentId, position) =>
    set((state) => {
      const previous = state.positions[documentId];
      if (
        previous &&
        previous.line === position.line &&
        previous.col === position.col &&
        previous.selectionLength === position.selectionLength &&
        Math.abs(previous.scrollTop - position.scrollTop) < 1
      ) {
        return state;
      }
      return { positions: { ...state.positions, [documentId]: position } };
    }),

  forget: (documentId) =>
    set((state) => {
      if (!(documentId in state.positions)) return state;
      const positions = { ...state.positions };
      delete positions[documentId];
      return { positions };
    }),
}));

export function cursorOf(documentId: string | null): CursorPosition {
  if (!documentId) return EMPTY;
  return useCursorStore.getState().positions[documentId] ?? EMPTY;
}
