/**
 * Debounced Markdown rendering.
 *
 * One pipeline run per settled keystroke burst. Renders are generation-checked
 * so a slow render for older text can never overwrite a newer result, and the
 * Shiki grammar cache is primed at startup so the first preview is already fast.
 */

import { useEffect, useRef } from "react";

import { renderMarkdown, type RenderOptions } from "@/markdown/renderer/pipeline";
import { primeHighlighter } from "@/markdown/code/highlighter";
import { usePreviewStore } from "./previewStore";

/** Preview refresh delay: fast enough to feel live, slow enough to stay cheap. */
const RENDER_DEBOUNCE_MS = 90;

export interface UseMarkdownRenderOptions {
  documentId: string | null;
  content: string;
  render: RenderOptions;
  /** Skip rendering entirely (preview hidden and outline closed). */
  enabled: boolean;
}

export function useMarkdownRender({ documentId, content, render, enabled }: UseMarkdownRenderOptions): void {
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The render options object is rebuilt on every React render; compare the
  // fields that actually affect the output instead of the reference.
  const renderKey = [
    render.allowRawHtml,
    render.renderMath,
    render.headingAnchors,
    render.documentDir ?? "",
    render.appearance,
    render.codeTheme,
    render.lineWrapCode,
  ].join("|");

  // Updated after each render: writing to a ref during render is a React
  // correctness violation, and the value is only read from async continuations.
  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
  });

  useEffect(() => {
    primeHighlighter();
  }, []);

  useEffect(() => {
    const preview = usePreviewStore.getState();

    if (!enabled || !documentId) {
      preview.clear();
      return;
    }

    if (timer.current !== undefined) clearTimeout(timer.current);

    // Mark the preview stale the moment a render is needed. Waiting until the
    // debounce fires would leave a window in which the output looks current
    // while it still reflects the previous settings — long enough for the
    // print flow to capture the wrong theme.
    if (content.length > 0) usePreviewStore.getState().setPending(true);

    const run = async () => {
      const current = (generation.current += 1);

      const result = await renderMarkdown(content, renderRef.current);
      if (current !== generation.current) return; // superseded by newer input
      usePreviewStore.getState().setRendered(documentId, result.html, result.outline);
    };

    if (content.length === 0) {
      void run();
    } else {
      timer.current = setTimeout(() => void run(), RENDER_DEBOUNCE_MS);
    }

    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, [documentId, content, renderKey, enabled]);
}
