/**
 * Export the rendered preview as a standalone HTML document.
 *
 * The stylesheet is embedded by importing the very same CSS file the
 * application uses, so an exported document cannot drift from what the user saw.
 * `mdasset://` image URLs are rewritten back to ordinary relative paths, because
 * the custom scheme only exists inside the application.
 */

import markdownCss from "@/styles/markdown.css?raw";
import katexCss from "katex/dist/katex.min.css?raw";

import { previewContainer } from "./previewApi";
import { basename, escapeHtml, stem } from "@/shared/util";

/**
 * Prefixes the asset protocol uses, in the Windows and POSIX forms.
 *
 * Matched with plain string operations rather than a pattern so the intent is
 * obvious: this is URL bookkeeping, nothing here reaches the operating system.
 */
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

/** Turn an asset URL back into a path relative to the document directory. */
function assetUrlToRelativePath(url: string, documentDir: string | null): string {
  const encoded = stripAssetPrefix(url);
  if (encoded === null) return url;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return url;
  }

  if (!documentDir) return decoded;

  const normalise = (value: string) => value.replace(/\\/g, "/");
  const base = normalise(documentDir).replace(/\/+$/, "");
  const target = normalise(decoded);

  if (target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return target.slice(base.length + 1);
  }
  return decoded;
}

export interface ExportOptions {
  title: string;
  documentDir: string | null;
  appearance: "light" | "dark";
}

/** Produce a complete HTML document for the current preview contents. */
export function buildExportHtml(options: ExportOptions): string {
  const container = previewContainer();
  const clone = container?.cloneNode(true) as HTMLElement | undefined;

  if (clone) {
    for (const image of clone.querySelectorAll<HTMLImageElement>("img[src]")) {
      const src = image.getAttribute("src") ?? "";
      if (isAssetUrl(src)) {
        image.setAttribute("src", assetUrlToRelativePath(src, options.documentDir));
      }
    }
    // Interactive controls make no sense in a static document.
    for (const control of clone.querySelectorAll("button")) {
      control.remove();
    }
  }

  const body = clone?.innerHTML ?? "<p>Nothing to export.</p>";
  const themeClass = `markdown-body--${options.appearance}`;
  const background = options.appearance === "dark" ? "#0d1117" : "#ffffff";

  return `<!doctype html>
<html lang="en" data-theme="${options.appearance}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>
${katexCss}
</style>
<style>
html, body { margin: 0; padding: 0; background: ${background}; }
body { padding: 32px 16px 64px; }
${markdownCss}
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
