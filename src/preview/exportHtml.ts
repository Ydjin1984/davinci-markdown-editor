/**
 * Export the rendered preview as a standalone HTML document.
 *
 * "Standalone" is meant literally: stylesheets, syntax highlighting, diagram
 * SVGs, images and the KaTeX fonts all end up inside the file, so it can be
 * opened on a machine that has never seen this repository, mailed as an
 * attachment, or archived next to a release.
 *
 * The stylesheet is imported from the very same files the application uses, so
 * an exported document cannot drift from what the user saw.
 */

import markdownCss from "@/styles/markdown.css?raw";
import printCss from "@/styles/print.css?raw";
import katexCss from "katex/dist/katex.min.css?raw";

import { previewContainer } from "./previewApi";
import * as ipc from "@/shared/ipc";
import { basename, escapeHtml, stem } from "@/shared/util";

/**
 * Hashed URLs for the KaTeX web fonts, resolved by Vite at build time.
 *
 * Fetching them back at export time is what lets the maths in an exported file
 * keep its real typography instead of falling back to a system serif.
 */
const KATEX_FONTS = import.meta.glob("/node_modules/katex/dist/fonts/*.woff2", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ASSET_PREFIXES = ["mdasset://localhost/", "http://mdasset.localhost/"];

function stripAssetPrefix(url: string): string | null {
  const lower = url.toLowerCase();
  for (const prefix of ASSET_PREFIXES) {
    if (lower.startsWith(prefix)) return url.slice(prefix.length);
  }
  return null;
}

export function isAssetUrl(url: string): boolean {
  return stripAssetPrefix(url) !== null;
}

/** Decode an asset URL back into the absolute path it was built from. */
function assetUrlToPath(url: string): string | null {
  const encoded = stripAssetPrefix(url);
  if (encoded === null) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked: a single spread over a megabyte would overflow the call stack.
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Replace every font reference the KaTeX stylesheet makes with its bytes. */
async function inlineKatexFonts(css: string): Promise<string> {
  const entries = Object.entries(KATEX_FONTS);
  if (entries.length === 0) return css;

  const inlined = new Map<string, string>();
  await Promise.all(
    entries.map(async ([path, url]) => {
      const name = path.split("/").pop();
      if (!name) return;
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        inlined.set(name, `data:font/woff2;base64,${toBase64(await response.arrayBuffer())}`);
      } catch {
        // A font that cannot be read leaves its reference in place; the export
        // still works, it just falls back to the system serif for that face.
      }
    }),
  );

  return css.replace(/url\((?:"|')?([^"')]+)(?:"|')?\)/g, (match, reference: string) => {
    const name = reference.split("/").pop();
    const data = name ? inlined.get(name) : undefined;
    return data ? `url(${data})` : match;
  });
}

/**
 * Embed every local image as a `data:` URL.
 *
 * Anything that was not resolved to a local file — a remote URL, an inline
 * image — is left exactly as it is.
 */
async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[src]"));

  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute("src") ?? "";
      // What the author wrote, before the pipeline rewrote it.
      const authored = image.dataset.source || source;
      // The pipeline records the absolute path while rewriting; fall back to
      // decoding the asset URL for images that were not rewritten.
      const absolute = image.dataset.resolved || assetUrlToPath(source);

      // Internal bookkeeping. `data-resolved` in particular holds the author's
      // real directory layout and must not travel into a shared file.
      image.removeAttribute("data-source");
      image.removeAttribute("data-resolved");
      image.removeAttribute("loading");

      if (!absolute) return;

      try {
        image.setAttribute("src", await ipc.readAssetDataUrl(absolute));
      } catch {
        // Keep the reference the author wrote: it still resolves for a reader
        // who received the images alongside the document.
        image.setAttribute("src", authored);
      }
    }),
  );
}

/** Drop the affordances that only make sense inside the application. */
function stripInteractiveMarkup(root: HTMLElement): void {
  for (const button of Array.from(root.querySelectorAll("button"))) {
    button.remove();
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-line]"))) {
    element.removeAttribute("data-line");
  }
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-failed]"))) {
    element.removeAttribute("data-failed");
  }

  // A failed image keeps the resolved absolute path in its tooltip, which is
  // useful while editing and an unwanted disclosure of the author's directory
  // layout once the file is shared.
  for (const card of Array.from(root.querySelectorAll<HTMLElement>(".md-image-error"))) {
    const reference = card.querySelector(".md-image-error-path")?.textContent;
    if (reference) card.setAttribute("title", reference);
    else card.removeAttribute("title");
  }
}

export interface ExportOptions {
  title: string;
  documentDir: string | null;
  appearance: "light" | "dark";
}

/** Build a complete, self-contained HTML document for the current preview. */
export async function buildExportHtml(options: ExportOptions): Promise<string> {
  const container = previewContainer();
  const clone = container?.cloneNode(true) as HTMLElement | undefined;

  if (clone) {
    stripInteractiveMarkup(clone);
    await inlineImages(clone);
  }

  const [fontsCss] = await Promise.all([inlineKatexFonts(katexCss)]);

  const body = clone?.innerHTML ?? "<p>Nothing to export.</p>";
  const themeClass = `markdown-body--${options.appearance}`;
  const background = options.appearance === "dark" ? "#0d1117" : "#ffffff";

  return `<!doctype html>
<html lang="en" data-theme="${options.appearance}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="DaVinci Markdown Editor">
<title>${escapeHtml(options.title)}</title>
<style>
/* KaTeX, with its web fonts embedded. */
${fontsCss}
</style>
<style>
/* Markdown rendering, identical to the application's preview. */
${markdownCss}
</style>
<style>
/* Reused unchanged: the rules that hide application chrome simply find nothing
   to match here, and the page setup and pagination rules still apply, so this
   file also prints from a browser without further work. */
${printCss}
</style>
<style>
html, body { margin: 0; padding: 0; background: ${background}; }
body { padding: 32px 16px 64px; }
@media print { body { padding: 0; } }
</style>
</head>
<body>
<article class="markdown-body ${themeClass}">
${body}
</article>
</body>
</html>
`;
}

/** Suggested file name for an export of the given document. */
export function exportFileName(title: string, extension: string): string {
  return `${stem(basename(title))}.${extension}`;
}
