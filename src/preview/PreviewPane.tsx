/**
 * The rendered Markdown preview.
 *
 * HTML is injected with `innerHTML`, which never executes `<script>`; combined
 * with the sanitiser that is the whole reason a document cannot run code. Every
 * interactive affordance in the output (copy buttons, diagram controls, links)
 * is wired through one delegated click handler, so no per-element listeners are
 * ever attached to document-controlled nodes.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { usePreviewStore } from "./previewStore";
import { setPreviewContainer } from "./previewApi";
import {
  collectAnchors,
  resetScrollSync,
  syncEditorToPreview,
  syncPreviewToEditor,
  type Anchor,
} from "./scrollSync";
import { activeEditor } from "@/editor/editorApi";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { useSettingsStore } from "@/settings/settingsStore";
import { useUiStore } from "@/app/uiStore";
import { hydrateDiagrams, applyZoom, fitDiagram, standaloneSvg } from "@/mermaid/hydrate";
import { copyText } from "@/shared/clipboard";
import * as ipc from "@/shared/ipc";
import { t } from "@/shared/i18n";
import { basename, cx, isMarkdownPath, resolveLinkTarget, stem } from "@/shared/util";

/**
 * Hydrate the diagrams and publish whether any are still being drawn.
 *
 * The print flow waits on that flag: printing a half-drawn diagram produces a
 * blank box in the PDF.
 */
function reportHydration(
  container: HTMLElement,
  options: Parameters<typeof hydrateDiagrams>[1],
  controller: AbortController,
  refreshAnchors: () => void,
): void {
  const result = hydrateDiagrams(container, options, controller.signal, () => {
    refreshAnchors();
    usePreviewStore.getState().setDiagramsPending(false);
  });
  usePreviewStore.getState().setDiagramsPending(result.pending > 0);
  refreshAnchors();
}

export function PreviewPane() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const anchorsRef = useRef<Anchor[]>([]);
  const htmlRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const frameRef = useRef(0);

  const html = usePreviewStore((state) => state.html);
  const pending = usePreviewStore((state) => state.pending);
  const document = useDocumentsStore((state) => {
    const active = state.documents.find((item) => item.id === state.activeId);
    return active ?? null;
  });
  const preview = useSettingsStore((state) => state.settings.preview);
  // The palette has to follow the same decision the Markdown pipeline was
  // given. Printing renders with the light theme, so reading the stored
  // appearance here would leave the page dark around light-highlighted code.
  const appearance = useUiStore((state) => (state.printing ? "light" : state.appearance));

  // Derived, not mirrored into state: a document removed on disk gets a banner.
  const warning =
    document?.external === "removed" ? t("dialog.externalBody", { name: document.title }) : null;

  const diagramOptions = useMemo(
    () => ({ appearance, theme: preview.mermaidTheme }),
    [appearance, preview.mermaidTheme],
  );

  const refreshAnchors = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    anchorsRef.current = collectAnchors(container);
  }, []);

  // Expose the live DOM so exports contain exactly what the user is looking at.
  useEffect(() => {
    setPreviewContainer(containerRef.current);
    return () => setPreviewContainer(null);
  }, []);

  /**
   * Replace a broken image with an explanation.
   *
   * A bare broken-image icon gives the user nothing to act on. The asset
   * protocol already knows why it refused a request, so we ask it and say which
   * of the three realistic causes applies.
   *
   * `error` does not bubble, hence the capture-phase listener on the container.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleError = (event: Event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      if (image.dataset.failed === "1") return; // Guard against a retry loop.
      if (!image.closest(".markdown-body")) return; // Only inside the preview.

      image.dataset.failed = "1";
      const reference = image.dataset.source || image.getAttribute("alt") || image.src;
      const placeholder = buildImagePlaceholder(reference);
      image.replaceWith(placeholder);

      const resolved = image.dataset.resolved;
      if (!resolved) {
        // No local path was derived, so the target was refused outright rather
        // than looked up on disk.
        markUnsupportedTarget(placeholder);
        return;
      }

      void ipc
        .probeAsset(resolved)
        .then((probe) => describeImageFailure(placeholder, reference, probe))
        .catch(() => undefined);
    };

    container.addEventListener("error", handleError, true);
    return () => container.removeEventListener("error", handleError, true);
  }, []);

  // Inject the rendered HTML and bring the diagrams to life.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (htmlRef.current === html) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const previousScroll = container.scrollTop;
    htmlRef.current = html;
    container.innerHTML = html;
    container.scrollTop = previousScroll;

    reportHydration(container, diagramOptions, controller, refreshAnchors);
  }, [html, diagramOptions, refreshAnchors]);

  // Re-hydrate when the colour scheme changes, even if the HTML is identical.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !htmlRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    reportHydration(container, diagramOptions, controller, refreshAnchors);
  }, [diagramOptions, refreshAnchors]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Anchor positions change with the pane size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => refreshAnchors());
    observer.observe(container);
    return () => observer.disconnect();
  }, [refreshAnchors]);

  useEffect(() => {
    resetScrollSync();
  }, [document?.id]);

  // Editor → preview.
  useEffect(() => {
    if (!preview.syncScroll) return;

    let disposed = false;
    let detach: (() => void) | null = null;

    const attach = () => {
      if (disposed) return;
      const view = activeEditor();
      if (!view) {
        requestAnimationFrame(attach);
        return;
      }
      const handler = () => {
        const container = containerRef.current;
        if (!container) return;
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0;
          syncEditorToPreview(view, container, anchorsRef.current);
        });
      };
      view.scrollDOM.addEventListener("scroll", handler, { passive: true });
      detach = () => view.scrollDOM.removeEventListener("scroll", handler);
    };

    attach();
    return () => {
      disposed = true;
      detach?.();
    };
  }, [preview.syncScroll]);

  // Preview → editor.
  useEffect(() => {
    if (!preview.syncScroll) return;
    const container = containerRef.current;
    if (!container) return;

    const handler = () => {
      const view = activeEditor();
      if (!view) return;
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        syncPreviewToEditor(view, container, anchorsRef.current);
      });
    };

    container.addEventListener("scroll", handler, { passive: true });
    return () => container.removeEventListener("scroll", handler);
  }, [preview.syncScroll]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const container = containerRef.current;
      if (!container) return;

      const copyButton = target.closest<HTMLElement>("[data-code-action='copy']");
      if (copyButton) {
        event.preventDefault();
        const block = copyButton.closest(".md-code");
        const code = block?.querySelector("pre")?.textContent ?? "";
        void copyText(code).then((copied) => {
          useUiStore
            .getState()
            .notify(copied ? t("toast.copied") : t("toast.copyFailed"), copied ? "success" : "error");
        });
        return;
      }

      const diagramButton = target.closest<HTMLElement>("[data-diagram-action]");
      if (diagramButton) {
        event.preventDefault();
        const block = diagramButton.closest<HTMLElement>(".md-diagram");
        if (!block) return;
        const action = diagramButton.dataset.diagramAction;
        const currentZoom = Number(block.dataset.diagramZoom ?? "1") || 1;

        switch (action) {
          case "zoom-in":
            applyZoom(block, currentZoom * 1.25);
            break;
          case "zoom-out":
            applyZoom(block, currentZoom / 1.25);
            break;
          case "fit":
            fitDiagram(block);
            break;
          case "reset":
            applyZoom(block, 1);
            break;
          case "copy-svg": {
            const svg = standaloneSvg(block);
            if (!svg) return;
            void copyText(svg).then((copied) => {
              useUiStore
                .getState()
                .notify(copied ? t("toast.copied") : t("toast.copyFailed"), copied ? "success" : "error");
            });
            break;
          }
          case "export-svg": {
            const svg = standaloneSvg(block);
            if (!svg) return;
            const suggested = `${stem(document?.title ?? "diagram")}-diagram.svg`;
            void (async () => {
              const path = await ipc.pickSavePath(suggested, "svg", null);
              if (!path) return;
              try {
                await ipc.writeExportFile(path, svg);
                useUiStore.getState().notify(t("toast.exported", { name: basename(path) }), "success");
              } catch (error) {
                await ipc.confirmDialog(t("error.genericTitle"), String(error), { kind: "error" });
              }
            })();
            break;
          }
          default:
            break;
        }
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!href) return;

      event.preventDefault();

      if (href.startsWith("#")) {
        // Scoped and escaped: never resolve an id against the whole document.
        const element = container.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        if (!preview.openExternalLinks) return;
        void ipc.openExternalUrl(href).catch((error) => {
          useUiStore.getState().notify(String(error), "error");
        });
        return;
      }

      // Relative targets: Markdown files open as documents, everything else is
      // left alone rather than navigating the webview away from the app.
      const documentPath = document?.path ?? null;
      const documentDir = documentPath ? documentPath.replace(/[\\/][^\\/]*$/, "") : null;
      const absolute = resolveLinkTarget(href, documentDir);
      if (isMarkdownPath(absolute)) {
        void useDocumentsStore.getState().openPaths([absolute]);
      }
    },
    [document?.path, document?.title, preview.openExternalLinks],
  );

  const showEmpty = !document;
  const showNothingToPreview = document && !html.trim();

  return (
    <div className={cx("preview-pane", pending && "is-pending")}>
      {warning && <div className="preview-banner">{warning}</div>}
      <div
        className={cx("markdown-body", `markdown-body--${appearance}`)}
        ref={containerRef}
        onClick={handleClick}
        tabIndex={0}
        role="document"
        style={{ fontSize: `${preview.fontSize}px` }}
      />
      {showEmpty && <p className="pane-placeholder">{t("preview.noDocument")}</p>}
      {showNothingToPreview && !warning && <p className="pane-placeholder">{t("preview.empty")}</p>}
    </div>
  );
}

/**
 * Build the block that stands in for an image that failed to load.
 *
 * Inserted into the preview DOM directly; the preview's children are managed by
 * `innerHTML`, never by React, so this cannot conflict with reconciliation.
 */
function buildImagePlaceholder(reference: string): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "md-image-error";

  const heading = document.createElement("strong");
  heading.className = "md-image-error-title";
  heading.textContent = t("image.failedTitle");

  const path = document.createElement("span");
  path.className = "md-image-error-path";
  path.textContent = reference;

  const hint = document.createElement("span");
  hint.className = "md-image-error-hint";
  hint.textContent = t("image.failedBody");

  wrapper.append(heading, path, hint);
  return wrapper;
}

/** Refine the placeholder once the backend has explained the failure. */
/** Rewrite a placeholder when the target never became a file request. */
function markUnsupportedTarget(placeholder: HTMLElement): void {
  if (!placeholder.isConnected) return;

  const title = placeholder.querySelector(".md-image-error-title");
  const hint = placeholder.querySelector(".md-image-error-hint");
  if (!title || !hint) return;

  title.textContent = t("image.unsupportedTitle");
  hint.textContent = t("image.unsupportedBody");
}

/** Refine the placeholder once the backend has explained the failure. */
function describeImageFailure(placeholder: HTMLElement, reference: string, probe: ipc.AssetProbe): void {
  if (!placeholder.isConnected) return;

  const title = placeholder.querySelector(".md-image-error-title");
  const hint = placeholder.querySelector(".md-image-error-hint");
  if (!title || !hint) return;

  if (!probe.exists) {
    title.textContent = t("image.missingTitle");
    hint.textContent = t("image.missingBody");
  } else if (!probe.allowed) {
    title.textContent = t("image.blockedTitle");
    hint.textContent = t("image.blockedBody");
  } else if (!probe.inlineable) {
    title.textContent = t("image.unsupportedTitle");
    hint.textContent = t("image.unsupportedBody");
  }

  placeholder.setAttribute("title", `${reference}\n${probe.path}`);
}
