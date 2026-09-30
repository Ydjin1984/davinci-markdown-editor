/**
 * Bridge between document-relative asset paths and the `mdasset://` scheme.
 *
 * The URL shape differs per platform (`http://mdasset.localhost/…` on Windows,
 * `mdasset://localhost/…` elsewhere); `convertFileSrc` is the only supported way
 * to build it, so the whole UI goes through this one helper.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

const ASSET_SCHEME = "mdasset";

/** Schemes that already point somewhere and must not be rewritten. */
const EXTERNAL_SCHEME = /^(?:[a-z][a-z0-9+.-]*:)/i;

export function isExternalTarget(target: string): boolean {
  return EXTERNAL_SCHEME.test(target.trim());
}

/**
 * Build a preview-usable URL for an absolute local path.
 *
 * The Rust side validates the path against the set of directories the user
 * actually opened; a path outside them returns 403 and the image simply does
 * not load.
 */
export function toAssetUrl(absolutePath: string): string {
  try {
    return convertFileSrc(absolutePath, ASSET_SCHEME);
  } catch {
    return "";
  }
}

/** Resolve a link or image target, leaving absolute URLs untouched. */
export function resolveAssetTarget(
  target: string,
  documentDir: string | null,
  resolve: (path: string, base: string | null) => string,
): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  if (isExternalTarget(trimmed)) {
    // `file:` URLs are not something a document should be able to reach.
    return trimmed.startsWith("file:") ? null : trimmed;
  }
  if (!documentDir) return null;
  return resolve(trimmed, documentDir);
}
