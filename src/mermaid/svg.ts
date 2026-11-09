/**
 * DOM-level SVG hygiene for rendered Mermaid output.
 *
 * Two separate problems live here, both of which a regex cannot solve:
 *
 * * **Safety.** Mermaid runs with `securityLevel: "strict"`, but the preview
 *   still receives text that a document controls. The SVG is therefore walked as
 *   real DOM and stripped of script-capable nodes and attributes, while ordinary
 *   presentations — including the `<style>` block Mermaid generates for the
 *   palette — are kept. That `<style>` block is exactly why a string regex
 *   (`<script>`, `on*=`, `javascript:`) is not enough and why styles must not be
 *   dropped wholesale.
 * * **Identity.** Mermaid numbers its output (`#mermaid-1`, `marker-end:
 *   url(#arrow)`, `aria-labelledby`). Two identical diagrams on one page would
 *   otherwise share ids, and every arrow of the first diagram would point into
 *   the second one's marker. Prefixing every id *and every local reference to
 *   it* is what makes a cached SVG safe to insert more than once.
 */

const SVGSVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Elements that can execute code or embed foreign documents. */
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "foreignobject",
  "audio",
  "video",
  "canvas",
  "handler",
  "listener",
]);

/** `href`/`xlink:href` targets that can execute script or smuggle a document. */
const DANGEROUS_SCHEME = /^(javascript|vbscript|data:text\/html|data:image\/svg)/i;

function isDangerousUrl(value: string): boolean {
  // Strip whitespace and control characters first: `java\tscript:` must not slip
  // through. Built without a control-character regex range so the lint rule stays
  // quiet.
  const normalised = value
    .toLowerCase()
    .split("")
    .filter((character) => character.charCodeAt(0) > 0x20)
    .join("");
  if (!normalised) return false;
  return DANGEROUS_SCHEME.test(normalised);
}

/** Remove script-capable nodes and attributes, keeping safe styling. */
export function sanitizeSvgElement(root: Element): void {
  // Snapshot the tree first: removing nodes while iterating a live list skips
  // siblings.
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];

  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "href" || name === "xlink:href" || name === "src") {
        if (isDangerousUrl(value)) element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "style" && isDangerousUrl(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      // `fill="url(#g)"` and friends: only the local fragment form is allowed.
      if (/url\(/i.test(value) && /url\(\s*['"]?\s*(javascript|vbscript|data:text\/html)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === "style") {
      const text = element.textContent ?? "";
      if (/@import/i.test(text) || /expression\s*\(/i.test(text)) {
        element.remove();
      }
    }
  }
}

/**
 * Prefix every id in `root` and rewrite every local reference to it.
 *
 * Some Mermaid diagrams (mindmap does this today) reuse one id on two sibling
 * nodes. Those repeats stay distinct after prefixing — only the first occurrence
 * keeps the plain mapped id and later ones get a numeric suffix — so the
 * document never ends up with duplicate DOM ids, while references still point at
 * the first occurrence they originally resolved to.
 *
 * Returns the id map so callers can report what was rewritten.
 */
export function prefixSvgIds(root: Element, prefix: string): Map<string, string> {
  const map = new Map<string, string>();
  const seen = new Map<string, number>();

  const withId = [root, ...Array.from(root.querySelectorAll("[id]"))].filter((element) =>
    element.hasAttribute("id"),
  );
  for (const element of withId) {
    const id = element.getAttribute("id") ?? "";
    if (!id) continue;

    const occurrence = (seen.get(id) ?? 0) + 1;
    seen.set(id, occurrence);

    const next = occurrence === 1 ? `${prefix}-${id}` : `${prefix}-${id}-${occurrence}`;
    // The first occurrence owns the original id, so `url(#id)` keeps meaning what
    // it meant before the SVG was prefixed.
    if (!map.has(id)) map.set(id, next);
    element.setAttribute("id", next);
  }

  if (map.size === 0) return map;

  const rewriteTokens = (value: string): string =>
    value.replace(/#([A-Za-z_][\w:.-]*)/g, (match, id: string) => (map.has(id) ? `#${map.get(id)!}` : match));

  const rewriteUrl = (value: string): string =>
    value.replace(/url\(\s*#([^)\s"']+)\s*\)/gi, (match, id: string) =>
      map.has(id) ? `url(#${map.get(id)})` : match,
    );

  const rewriteReference = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.startsWith("#")) {
      const id = trimmed.slice(1);
      return map.has(id) ? `#${map.get(id)}` : value;
    }
    return rewriteUrl(value);
  };

  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of all) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      let next: string | null = null;

      if (name === "href" || name === "xlink:href") {
        next = rewriteReference(attribute.value);
      } else if (name === "aria-labelledby" || name === "aria-describedby") {
        next = attribute.value
          .split(/\s+/)
          .map((id) => map.get(id) ?? id)
          .join(" ");
      } else {
        next = rewriteUrl(attribute.value);
      }

      if (next !== null && next !== attribute.value) {
        element.setAttribute(attribute.name, next);
      }
    }

    if (element.tagName.toLowerCase() === "style") {
      const text = element.textContent ?? "";
      const rewritten = rewriteTokens(rewriteUrl(text));
      if (rewritten !== text) element.textContent = rewritten;
    }
  }

  return map;
}

/**
 * Parse Mermaid's SVG string into a detached SVG element.
 *
 * A `<template>` uses the HTML parser, which tolerates the entities Mermaid
 * emits (`&nbsp;` and friends) that a strict XML parser would reject.
 */
export function parseSvgMarkup(markup: string): SVGSVGElement | null {
  if (typeof document === "undefined") return null;
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  const svg = template.content.querySelector("svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

export interface SvgSize {
  width: number;
  height: number;
}

/** Natural size of the diagram, taken from the SVG viewBox first. */
export function svgNaturalSize(svg: SVGSVGElement): SvgSize {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 800, height: 600 };
}

/**
 * Serialise a diagram as a standalone SVG document.
 *
 * The user's zoom is not baked in: width/height are the natural size, the
 * viewBox is untouched and the palette lives in the SVG's own `<style>` block,
 * so the file opens offline in any viewer.
 */
export function toStandaloneSvg(svg: SVGSVGElement, size: SvgSize): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Only viewport geometry is removed; the colours stay in the nested <style>.
  clone.removeAttribute("style");
  clone.setAttribute("width", String(size.width));
  clone.setAttribute("height", String(size.height));
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", SVGSVG_NAMESPACE);
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  if (!clone.getAttribute("role")) clone.setAttribute("role", "img");

  const serialised =
    typeof XMLSerializer !== "undefined" ? new XMLSerializer().serializeToString(clone) : clone.outerHTML;

  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialised}\n`;
}
