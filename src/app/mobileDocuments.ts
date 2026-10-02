/**
 * Opening documents on Android.
 *
 * A phone shows one document at a time — there are no tabs in this shell — so
 * opening a file replaces whatever was on screen. Anything unsaved is asked
 * about first, exactly as closing a tab would ask on the desktop.
 */

import { useDocumentsStore } from "@/tabs/documentsStore";
import * as ipc from "@/shared/ipc";

/** Ask the system for a document and show it. */
export async function pickAndOpenOnMobile(): Promise<void> {
  const [uri] = await ipc.pickOpenFiles();
  if (uri) await openOnMobile(uri);
}

/**
 * Show the document behind a `content://` URI.
 *
 * Closing happens before opening so the old document is still on screen if the
 * user backs out of the unsaved-changes prompt.
 */
export async function openOnMobile(uri: string): Promise<void> {
  const store = useDocumentsStore.getState();

  const already = store.documents.find((document) => document.path === uri);
  if (already) {
    store.activate(already.id);
    return;
  }

  if (store.documents.length > 0) {
    const closed = await store.closeAll();
    if (!closed) return;
  }

  await useDocumentsStore.getState().openPaths([uri]);
}
