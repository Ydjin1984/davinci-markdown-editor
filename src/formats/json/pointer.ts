/**
 * RFC 6901 JSON Pointer helpers.
 *
 * A pointer is built from decoded keys and array indices. Two characters are
 * escaped: `~` becomes `~0` and `/` becomes `~1` — in that order, so an input
 * `~` never turns into `~01`.
 */

/** One pointer token: an object key or an array index. */
export type JsonPointerSegment = string | number;

/** Escape a single reference token (`~` → `~0`, `/` → `~1`). */
export function escapePointerSegment(segment: JsonPointerSegment): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Build a JSON Pointer from a path.
 *
 * The root pointer is the empty string, as the RFC defines it. Duplicate
 * object keys share one pointer: RFC 6901 cannot address them separately, so
 * the viewer keeps an index-based row identity next to the pointer.
 */
export function jsonPointer(segments: readonly JsonPointerSegment[]): string {
  if (segments.length === 0) return "";
  return `/${segments.map(escapePointerSegment).join("/")}`;
}
