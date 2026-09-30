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

/**
 * Point relative `src` attributes at the `mdasset://` scheme.
 *
 * Runs after sanitisation on purpose: the rewritten URL uses a custom scheme
 * that the sanitiser would reject, and the URL is ours, not the document's.
 * A path outside the directories the user opened is refused by Rust when the
 * webview requests it.
 */
function rehypeResolveAssets(options: RewriteOptions) {
  return (tree: Root) => {
    const dir = options.documentDir;
    if (!dir) return;

    visit(tree, "element", (node: Element) => {
      if (
        node.tagName !== "img" &&
        node.tagName !== "source" &&
        node.tagName !== "video" &&
        node.tagName !== "audio"
      ) {
        return;
      }
      const src = node.properties?.src;
      if (typeof src !== "string" || src.length === 0) return;
      // Anything with a scheme is either remote, inline or already resolved.
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return;

      const absolute = resolveLinkTarget(src, dir);
      const url = toAssetUrl(absolute);
      if (!url) return;

      node.properties = {
        ...node.properties,
        src: url,
        loading: "lazy",
        decoding: "async",
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
