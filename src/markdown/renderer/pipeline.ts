/**
 * The Markdown → HTML pipeline.
 *
 * Deliberately independent of React: it takes a string plus a settings snapshot
 * and returns HTML, an outline and the diagram sources. That keeps the parser
 * testable in isolation and reusable by future exporters.
 *
 * Stage order is the security boundary:
 *
 *   parse → GFM → math → mdast→hast → [raw HTML] → SANITIZE
 *         → slug → outline → assets → KaTeX → Shiki/Mermaid → HTML
 *
 * Everything to the right of SANITIZE is produced by our own code from text
 * that has already been verified, so it does not need to pass the schema again.
 * KaTeX runs with `trust: false`, which keeps `\href` and friends inert.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeStringify from "rehype-stringify";
import type { Element, ElementContent, Root } from "hast";
import { visit } from "unist-util-visit";

import { sanitizeSchema } from "../sanitize/schema";
import { rehypeCollectOutline, rehypeMermaid, rehypeShiki, rehypeSourceLines } from "./rehype-plugins";
import { resolveLinkTarget } from "@/shared/util";
import { toAssetUrl } from "@/shared/assets";
import type { OutlineItem, RenderedDocument } from "@/shared/types";

export interface RenderOptions {
  /** Parse raw HTML from the document and keep what survives sanitisation. */
  allowRawHtml: boolean;
  renderMath: boolean;
  headingAnchors: boolean;
  /** Directory of the document; every relative path resolves against it. */
  documentDir: string | null;
  appearance: "light" | "dark";
  codeTheme: string;
  lineWrapCode: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  allowRawHtml: true,
  renderMath: true,
  headingAnchors: false,
  documentDir: null,
  appearance: "light",
  codeTheme: "auto",
  lineWrapCode: false,
};

interface RewriteOptions {
  documentDir: string | null;
}

/** Elements whose `src` points at a file this preview may inline. */
const ASSET_TAGS = new Set(["img", "source", "video", "audio", "track"]);

/** `C:\…` or `C:/…` — a Windows drive path, not a URL scheme. */
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
/** Any `scheme:` prefix. */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** True when the target is a path on this machine rather than a URL. */
function isLocalTarget(value: string): boolean {
  return WINDOWS_DRIVE.test(value) || (!ANY_SCHEME.test(value) && !value.startsWith("//"));
}

/**
 * Decode a Markdown destination into a filesystem path.
 *
 * A destination is a URL, so `%20` means a space and a filename containing a
 * literal `%` has to be written `%25`. Malformed escapes leave the value alone
 * rather than throwing.
 */
function decodeDestination(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Remember the author's original `src` before the sanitiser runs.
 *
 * The sanitiser refuses a `src` such as `C:/images/a.png`, because a drive
 * letter is indistinguishable from a URL scheme. The attribute survives in
 * `data-source`, so the rewrite below can still resolve the path and a failed
 * load can still be explained to the user instead of showing a bare broken
 * icon.
 */
function rehypeCaptureAssetSources() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (!ASSET_TAGS.has(node.tagName)) return;
      const src = node.properties?.src;
      if (typeof src !== "string" || src.length === 0) return;
      // Only paths on this machine need rescuing: a remote URL, an inline data
      // URI or a rejected scheme never becomes a file request, so there is
      // nothing to resolve and nothing to explain. Leaving them alone also
      // keeps refused schemes such as `javascript:` out of the output entirely.
      if (!isLocalTarget(src)) return;
      node.properties = { ...node.properties, dataSource: src };
    });
  };
}

/**
 * Point local `src` attributes at the `mdasset://` scheme.
 *
 * Runs after sanitisation on purpose: the rewritten URL uses a custom scheme
 * the sanitiser would reject, and the URL is ours, not the document's. A path
 * outside the directories the user opened is refused by Rust when the webview
 * requests it.
 *
 * This plugin is the only thing that produces a `src`, so it also decides what
 * is allowed to become one: a captured source is only turned into a URL when it
 * is a local path. Anything else keeps whatever the sanitiser left.
 */
function rehypeResolveAssets(options: RewriteOptions) {
  return (tree: Root) => {
    const dir = options.documentDir;

    visit(tree, "element", (node: Element) => {
      if (!ASSET_TAGS.has(node.tagName)) return;

      const current = typeof node.properties?.src === "string" ? (node.properties.src as string) : "";
      const captured =
        typeof node.properties?.dataSource === "string" ? (node.properties.dataSource as string) : "";
      // Prefer what the author wrote; fall back to what survived sanitisation.
      const candidate = captured || current;
      if (!candidate) return;

      // A remote or inline URL is left exactly as the sanitiser decided.
      if (!isLocalTarget(candidate)) return;

      const reference = captured || current;
      if (!dir) return;

      const absolute = resolveLinkTarget(decodeDestination(reference), dir);
      const url = toAssetUrl(absolute);
      if (!url) return;

      node.properties = {
        ...node.properties,
        src: url,
        loading: "lazy",
        decoding: "async",
        // Kept so a load failure can be explained: the preview shows the
        // reference the author wrote, not the internal scheme URL.
        dataSource: reference,
        dataResolved: absolute,
      };
    });
  };
}

function buildProcessor(options: RenderOptions, outline: OutlineItem[], diagrams: string[]) {
  const processor = unified().use(remarkParse).use(remarkGfm);

  if (options.renderMath) {
    processor.use(remarkMath);
  }

  processor.use(remarkRehype, {
    // Raw HTML only becomes nodes when the user allowed it; the sanitiser
    // still has the final say on what survives.
    allowDangerousHtml: options.allowRawHtml,
  });

  if (options.allowRawHtml) {
    processor.use(rehypeRaw);
  }

  // Capture the author's asset references before the sanitiser can drop them.
  processor.use(rehypeCaptureAssetSources);
  processor.use(rehypeSanitize, sanitizeSchema);
  processor.use(rehypeSourceLines);
  processor.use(rehypeSlug);

  if (options.headingAnchors) {
    // Annotated explicitly so the object literal keeps its literal `type` and
    // satisfies the plugin's `ElementContent` union.
    const anchorContent: ElementContent = {
      type: "element",
      tagName: "span",
      properties: { className: ["md-anchor-icon"] },
      children: [{ type: "text", value: "#" }],
    };
    processor.use(rehypeAutolinkHeadings, {
      behavior: "append",
      properties: { className: ["md-anchor"] },
      content: anchorContent,
    });
  }

  processor.use(rehypeCollectOutline, outline);
  processor.use(rehypeResolveAssets, { documentDir: options.documentDir });

  if (options.renderMath) {
    // `throwOnError` is fixed to `false` by rehype-katex, so a malformed formula
    // renders in red instead of aborting the whole document.
    processor.use(rehypeKatex, {
      strict: "ignore",
      // `trust: false` keeps `\href`, `\url` and `\htmlClass` inert.
      trust: false,
      errorColor: "#d1242f",
      output: "htmlAndMathml",
    });
  }

  processor.use(rehypeMermaid, diagrams);
  processor.use(rehypeShiki, {
    appearance: () => options.appearance,
    theme: () => options.codeTheme,
    wrapLines: () => options.lineWrapCode,
  });

  processor.use(rehypeStringify, { allowDangerousHtml: false });

  return processor;
}

/**
 * Render Markdown to HTML.
 *
 * Never throws: a catastrophic pipeline failure is reported as a short message
 * inside an error block so the rest of the application keeps working.
 */
export async function renderMarkdown(
  source: string,
  options: Partial<RenderOptions> = {},
): Promise<RenderedDocument> {
  const resolved: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const outline: OutlineItem[] = [];
  const diagrams: string[] = [];

  try {
    const processor = buildProcessor(resolved, outline, diagrams);
    const file = await processor.process(source);
    return { html: String(file), outline, diagrams };
  } catch (error) {
    console.error("Markdown rendering failed", error);
    return {
      html: `<div class="md-render-error"><p>This document could not be rendered.</p></div>`,
      outline: [],
      diagrams: [],
    };
  }
}
