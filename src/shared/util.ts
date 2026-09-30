/** Small helpers shared across the UI. */

/** Trailing-edge debounce that keeps the latest arguments. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  wrapped.flush = (...args: A) => {
    wrapped.cancel();
    fn(...args);
  };
  return wrapped;
}

/** Join class names, skipping falsy values. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/** File name from a path that may use either separator. */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) return index === 0 ? trimmed.slice(0, 1) : "";
  return trimmed.slice(0, index);
}

export function extensionOf(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1).toLowerCase();
}

/** Path of the document without its extension, used for default Save As names. */
export function stem(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? name : name.slice(0, index);
}

export function isMarkdownPath(path: string): boolean {
  return ["md", "markdown", "mdown", "mkdn", "mkd", "mdx", "mdtxt", "mdtext"].includes(extensionOf(path));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Count words the way an editor status bar does: runs of non-whitespace. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

let idCounter = 0;

export function nextId(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `C:\…` or `C:/…` — a Windows drive path, not a URL scheme. */
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
/** `https:`, `mailto:`, `data:` and friends. */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Resolve a relative Markdown link against the document's directory.
 *
 * Anything that is already absolute — a URL, a protocol-relative target, a
 * POSIX root or a Windows drive path — is returned untouched. Resolving those
 * would corrupt them (`https://x/y` must never become `/docs/https://x/y`).
 */
export function resolveLinkTarget(href: string, documentDir: string | null): string {
  const trimmed = href.trim();
  if (!trimmed || !documentDir) return href;

  if (WINDOWS_DRIVE.test(trimmed)) return href;
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return href;
  if (URL_SCHEME.test(trimmed)) return href;

  const normalised = trimmed.replace(/\\/g, "/");
  const separator = documentDir.includes("\\") ? "\\" : "/";
  const isPosix = documentDir.startsWith("/");
  const parts = documentDir.split(/[\\/]/).filter(Boolean);

  for (const segment of normalised.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(segment);
  }

  return `${isPosix ? "/" : ""}${parts.join(separator)}`;
}

/** True when the target is something the preview can display as an image. */
export function isImageTarget(target: string): boolean {
  const withoutQuery = target.split(/[?#]/)[0] ?? "";
  return ["png", "jpg", "jpeg", "jpe", "gif", "webp", "avif", "bmp", "ico", "svg"].includes(
    extensionOf(withoutQuery),
  );
}

/** Line number (1-based) of a byte offset, used for Mermaid error reporting. */
export function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  const limit = Math.min(offset, text.length);
  for (let index = 0; index < limit; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
