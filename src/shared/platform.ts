/**
 * Which platform the interface is running on.
 *
 * The Android build shares every store, renderer and exporter with the desktop
 * one, but the two want different shells: a phone shows the rendered document
 * and almost nothing else, while the desktop shows panes, tabs and a menu bar.
 * Everything that differs is decided from here rather than scattered through
 * the components.
 */

const MOBILE_AGENT = /android|iphone|ipad|ipod/i;

/**
 * Debug aid: `?mobile=1` renders the phone shell in a desktop browser, which
 * is the only way to look at it without a device or an emulator.
 */
function forcedByQuery(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("mobile") === "1";
  } catch {
    return false;
  }
}

/** True inside the Android (or iOS) build of the application. */
export const isMobile: boolean =
  MOBILE_AGENT.test(typeof navigator === "undefined" ? "" : navigator.userAgent) || forcedByQuery();

/** True for a document the Android picker handed over instead of a path. */
export function isContentUri(path: string | null): boolean {
  return typeof path === "string" && path.startsWith("content://");
}
