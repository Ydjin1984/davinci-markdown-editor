/**
 * Clipboard access with a fallback.
 *
 * The asynchronous Clipboard API needs a secure context. Tauri serves the
 * webview from a `*.localhost` origin, which Chromium treats as trustworthy but
 * WebKitGTK has historically not, so a hidden-textarea fallback keeps Copy
 * working on Linux.
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
