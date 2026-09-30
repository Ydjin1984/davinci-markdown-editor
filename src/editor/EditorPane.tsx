/**
 * The source editor pane.
 *
 * A single CodeMirror view is reused for every tab. Switching documents swaps
 * the whole `EditorState`, which is what preserves per-document undo history —
 * re-creating the view would throw it away.
 */

import { useEffect, useMemo, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

import {
  appearanceExtensions,
  createCompartments,
  createEditorExtensions,
  layoutExtensions,
  readOnlyExtensions,
  typographyExtensions,
  type EditorCompartments,
} from "./codemirror/setup";
import { setActiveEditor } from "./editorApi";
import { useCursorStore } from "./cursorStore";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { useSettingsStore } from "@/settings/settingsStore";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";

/** How long typing is allowed to outpace the store before the text is flushed. */
const CONTENT_FLUSH_MS = 120;

export interface EditorPaneProps {
  onTogglePreview: () => void;
}

export function EditorPane({ onTogglePreview }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** Undo history and selection, kept per document. */
  const parkedStates = useRef(new Map<string, EditorState>());
  const compartmentsRef = useRef<EditorCompartments | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const lastEpochRef = useRef(-1);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const documents = useDocumentsStore((state) => state.documents);
  const activeId = useDocumentsStore((state) => state.activeId);
  const editorSettings = useSettingsStore((state) => state.settings.editor);
  const appearance = useUiStore((state) => state.appearance);

  const document = useMemo(
    () => documents.find((item) => item.id === activeId) ?? null,
    [documents, activeId],
  );

  // Values the CodeMirror callbacks read, without re-creating the view.
  // Written after each render: mutating a ref during render is a React
  // correctness violation, and these are only read from async continuations.
  const live = useRef({ editorSettings, appearance, activeId, onTogglePreview });
  useEffect(() => {
    live.current = { editorSettings, appearance, activeId, onTogglePreview };
  });

  function flushContent(): void {
    const view = viewRef.current;
    const id = live.current.activeId;
    if (!view || !id) return;
    useDocumentsStore.getState().setContent(id, view.state.doc.toString());
  }

  function handleDocChanged(): void {
    const id = live.current.activeId;
    if (!id) return;

    // Mark dirty immediately so the tab indicator is instant; the (potentially
    // large) text copy waits for the debounce.
    useDocumentsStore.getState().touch(id);

    if (flushTimer.current !== undefined) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = undefined;
      flushContent();
    }, CONTENT_FLUSH_MS);
  }

  function handleSelectionChanged(): void {
    const view = viewRef.current;
    const id = live.current.activeId;
    if (!view || !id) return;

    const range = view.state.selection.main;
    const line = view.state.doc.lineAt(range.head);
    useCursorStore.getState().set(id, {
      line: line.number,
      col: range.head - line.from + 1,
      selectionLength: Math.abs(range.to - range.from),
      scrollTop: view.scrollDOM.scrollTop,
    });
  }

  function buildExtensions(): ReturnType<typeof createEditorExtensions> {
    const compartments = compartmentsRef.current;
    if (!compartments) throw new Error("editor compartments are not ready");
    return createEditorExtensions({
      settings: live.current.editorSettings,
      appearance: live.current.appearance,
      readOnly: false,
      compartments,
      callbacks: {
        onOpenSearch: () => undefined,
        onTogglePreview: () => live.current.onTogglePreview(),
      },
      onDocChanged: handleDocChanged,
      onSelectionChanged: handleSelectionChanged,
    });
  }

  // Create the view once; every document is served by swapping its state.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    compartmentsRef.current = createCompartments();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "", extensions: buildExtensions() }),
    });
    viewRef.current = view;
    setActiveEditor(view);

    return () => {
      if (flushTimer.current !== undefined) clearTimeout(flushTimer.current);
      // Deregister before destroying so no caller can reach a dead view.
      setActiveEditor(null);
      viewRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap documents when the active tab changes.
  useEffect(() => {
    const view = viewRef.current;
    const compartments = compartmentsRef.current;
    if (!view || !compartments) return;

    const previous = activeIdRef.current;
    if (previous && previous !== activeId) {
      parkedStates.current.set(previous, view.state);
      const cursor = useCursorStore.getState().positions[previous];
      if (cursor) {
        useDocumentsStore.getState().setCursorAt(previous, cursor.line, cursor.col, cursor.scrollTop);
      }
    }
    activeIdRef.current = activeId;

    if (!activeId) return;

    const record = useDocumentsStore.getState().documents.find((item) => item.id === activeId);
    if (!record) return;

    const next =
      parkedStates.current.get(activeId) ??
      EditorState.create({ doc: record.content, extensions: buildExtensions() });

    view.setState(next);

    // A parked state carries the compartment values from when it was put aside;
    // re-apply the current ones so theme and typography changes reach every tab.
    view.dispatch({
      effects: [
        compartments.appearance.reconfigure(appearanceExtensions(live.current.appearance)),
        compartments.layout.reconfigure(layoutExtensions(live.current.editorSettings)),
        compartments.typography.reconfigure(typographyExtensions(live.current.editorSettings)),
        compartments.readOnly.reconfigure(readOnlyExtensions(record.readOnly)),
      ],
    });

    lastEpochRef.current = record.contentEpoch;
    const scrollTop = useCursorStore.getState().positions[activeId]?.scrollTop ?? 0;
    requestAnimationFrame(() => {
      const current = viewRef.current;
      if (current) current.scrollDOM.scrollTop = scrollTop;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Push content that was replaced from outside the editor (reload, discard).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !document) return;
    if (lastEpochRef.current === document.contentEpoch) return;
    lastEpochRef.current = document.contentEpoch;
    if (view.state.doc.toString() === document.content) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: document.content },
      selection: { anchor: 0 },
    });
    parkedStates.current.delete(document.id);
  }, [document]);

  // Reconfigure in place when settings, appearance or read-only state change.
  useEffect(() => {
    const view = viewRef.current;
    const compartments = compartmentsRef.current;
    if (!view || !compartments) return;

    view.dispatch({
      effects: [
        compartments.appearance.reconfigure(appearanceExtensions(appearance)),
        compartments.layout.reconfigure(layoutExtensions(editorSettings)),
        compartments.typography.reconfigure(typographyExtensions(editorSettings)),
        compartments.readOnly.reconfigure(readOnlyExtensions(document?.readOnly ?? false)),
      ],
    });
  }, [appearance, editorSettings, document?.readOnly]);

  // Drop parked state for documents that are no longer open.
  useEffect(() => {
    const open = new Set(documents.map((item) => item.id));
    for (const id of parkedStates.current.keys()) {
      if (!open.has(id)) parkedStates.current.delete(id);
    }
  }, [documents]);

  return (
    <div className={cx("editor-pane", !document && "is-empty")}>
      <div className="editor-host" ref={hostRef} />
      {!document && <p className="pane-placeholder">{t("editor.noDocument")}</p>}
      {document?.readOnly && <div className="editor-banner">{t("editor.readOnlyBanner")}</div>}
    </div>
  );
}
