/**
 * Export actions: PDF, self-contained HTML, and copying the rendered markup.
 *
 * Kept out of the menu component so the ordering that matters — re-render,
 * wait, then print — lives in one readable place.
 */

import { buildExportHtml, exportFileName } from "./exportHtml";
import { usePreviewStore } from "./previewStore";
import { useUiStore } from "@/app/uiStore";
import { useDocumentsStore } from "@/tabs/documentsStore";
import * as ipc from "@/shared/ipc";
import { copyText } from "@/shared/clipboard";
import { t } from "@/shared/i18n";
import { basename } from "@/shared/util";

/** How long to wait for the preview to settle before printing anyway. */
const SETTLE_TIMEOUT_MS = 4000;
const SETTLE_POLL_MS = 50;

/** Directory of a document, used to resolve its relative links. */
function documentDirOf(path: string | null): string | null {
  if (!path) return null;
  return path.replace(/[\\/][^\\/]*$/, "");
}

function notify(message: string, tone: "info" | "success" | "error" = "info"): void {
  useUiStore.getState().notify(message, tone);
}

/**
 * Wait until the preview reflects the newest text and every diagram is drawn.
 *
 * Printing reads the live DOM, so starting before the re-render finishes would
 * capture the previous theme or a half-drawn diagram.
 */
async function waitForPreviewSettled(): Promise<void> {
  // Let the effect that reacts to the theme switch run before the first check:
  // it is what marks the preview stale, and a check issued before React flushed
  // would see the previous output as ready.
  await nextFrames(3);

  const deadline = Date.now() + SETTLE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { pending, diagramsPending } = usePreviewStore.getState();
    if (!pending && !diagramsPending) {
      // One more frame so the browser has laid the result out.
      await nextFrames(1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

/** Wait for the given number of animation frames. */
function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function currentDocument(): { title: string; directory: string | null } | null {
  const active = useDocumentsStore.getState().activeDocument();
  if (!active) return null;
  return { title: active.title, directory: documentDirOf(active.path) };
}

/**
 * Open the system print dialog, where the user chooses "save as PDF".
 *
 * Both WebView2 and WebKitGTK offer that option, and both render through the
 * same engine that drew the preview, so the file matches the screen and
 * paginates properly. Producing a PDF byte stream ourselves would mean
 * re-implementing Markdown layout, tables and diagram rasterisation at a
 * fraction of the fidelity.
 */
export async function printDocument(): Promise<void> {
  if (!currentDocument()) return;

  const ui = useUiStore.getState();
  ui.setPrinting(true);

  try {
    await waitForPreviewSettled();
    await ipc.printDocument();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "error");
  } finally {
    useUiStore.getState().setPrinting(false);
  }
}

/** Write a self-contained HTML file next to the document, or wherever asked. */
export async function exportHtml(): Promise<void> {
  const document = currentDocument();
  if (!document) return;

  const path = await ipc.pickSavePath(exportFileName(document.title, "html"), "html", null);
  if (!path) return;

  try {
    const html = await buildExportHtml({
      title: document.title,
      documentDir: document.directory,
      appearance: useUiStore.getState().appearance,
    });
    await ipc.writeExportFile(path, html);
    notify(t("toast.exported", { name: basename(path) }), "success");
  } catch (error) {
    await ipc.confirmDialog(t("error.genericTitle"), String(error), { kind: "error" });
  }
}

/** Put the same self-contained markup on the clipboard. */
export async function copyHtml(): Promise<void> {
  const document = currentDocument();
  if (!document) return;

  try {
    const html = await buildExportHtml({
      title: document.title,
      documentDir: document.directory,
      appearance: useUiStore.getState().appearance,
    });
    const copied = await copyText(html);
    notify(copied ? t("toast.copied") : t("toast.copyFailed"), copied ? "success" : "error");
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "error");
  }
}
