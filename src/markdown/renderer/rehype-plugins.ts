/**
 * Custom rehype plugins.
 *
 * Everything here runs *after* sanitisation, so the nodes these plugins create
 * are trusted by construction: they are built by our own code from already
 * verified text, never assembled from raw document bytes.
 */

import type { Element, ElementContent, Parent, Properties, Root, RootContent } from "hast";
import { visit } from "unist-util-visit";
import type { BundledLanguage } from "shiki";
import {
  ensureLanguage,
  getHighlighter,
  isHighlightable,
  normaliseFenceLanguage,
  themeForAppearance,
  type Highlighter,
} from "../code/highlighter";
import type { OutlineItem } from "@/shared/types";

/** Block-level tags that receive a `data-line` marker for scroll synchronisation. */
const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "table",
  "hr",
  "dl",
  "figure",
  "div",
  "section",
]);

/** Code blocks longer than this are left unhighlighted to keep the UI responsive. */
const HIGHLIGHT_CHAR_LIMIT = 120_000;

export function textContent(node: RootContent | ElementContent): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "raw":
      return node.value;
    case "element":
      return node.children.map(textContent).join("");
    default:
      return "";
  }
}

function classList(element: Element): string[] {
  // Typed as `unknown`: the hast property union narrows to `never` in the scalar
  // branch and would reject the `split` call.
  const value: unknown = element.properties?.className;
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [];
}

function findCodeChild(element: Element): Element | undefined {
  return element.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
}

/** Drop the single trailing newline a fenced code block carries. */
function trimFenceBody(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function lineOf(element: Element): number | undefined {
  return element.position?.start?.line;
}

/**
 * Tag every block element with the source line it came from.
 *
 * The preview uses these markers for editor↔preview scroll synchronisation and
 * for jumping to a line from the outline. Positions are only meaningful while
 * the tree still comes straight from the Markdown parser, so this plugin runs
 * before any node-replacing plugin.
 */
export function rehypeSourceLines() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (!BLOCK_TAGS.has(node.tagName)) return;
      const line = lineOf(node);
      if (line === undefined) return;
      node.properties = { ...node.properties, dataLine: String(line) };
    });
  };
}

/**
 * Stamp headings with their source line and collect the outline.
 *
 * Runs after `rehype-slug`, so every heading already carries a stable id the
 * outline can link to.
 */
export function rehypeCollectOutline(sink: OutlineItem[]) {
  return (tree: Root) => {
    const flat: OutlineItem[] = [];

    visit(tree, "element", (node) => {
      const match = /^h([1-6])$/.exec(node.tagName);
      if (!match) return;

      const line = lineOf(node) ?? 1;
      const existingId = node.properties?.id;
      const id = typeof existingId === "string" && existingId.length > 0 ? existingId : `heading-${line}`;
      if (typeof existingId !== "string") {
        node.properties = { ...node.properties, id };
      }

      const text = textContent(node).trim();
      flat.push({ id, text: text || id, level: Number(match[1]), line, children: [] });
    });

    // Fold the flat heading list into a tree using a level stack.
    const roots: OutlineItem[] = [];
    const stack: OutlineItem[] = [];

    for (const item of flat) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= item.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(item);
      } else {
        roots.push(item);
      }
      stack.push(item);
    }

    sink.push(...roots);
  };
}

/**
 * Replace ```mermaid fences with a diagram container.
 *
 * The original source is kept inside the container as escaped text so it stays
 * visible and copyable when rendering fails, and so the client renderer can read
 * it back without any re-encoding.
 */
export function rehypeMermaid(diagrams: string[]) {
  return (tree: Root) => {
    const targets: Array<{ parent: Parent; index: number; element: Element; source: string }> = [];

    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;
      const code = findCodeChild(node);
      if (!code) return;
      if (!classList(code).includes("language-mermaid")) return;

      // A fenced block's body excludes the newline before the closing fence.
      // Trimming it keeps the diagram cache key stable regardless of how the
      // fence was written.
      targets.push({ parent, index, element: node, source: trimFenceBody(textContent(code)) });
    });

    for (const target of targets) {
      const index = diagrams.length;
      diagrams.push(target.source);
      // Replacing in place keeps the remaining collected indices valid.
      target.parent.children[target.index] = buildDiagramElement(
        target.source,
        lineOf(target.element) ?? 1,
        index,
      );
    }
  };
}

function actionButton(action: string, label: string, title: string): Element {
  return {
    type: "element",
    tagName: "button",
    properties: { type: "button", className: ["md-diagram-action"], dataDiagramAction: action, title },
    children: [{ type: "text", value: label }],
  };
}

function buildDiagramElement(source: string, line: number, index: number): Element {
  const sourceElement: Element = {
    type: "element",
    tagName: "pre",
    properties: { className: ["md-diagram-source"] },
    children: [{ type: "text", value: source }],
  };

  const stage: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["md-diagram-stage"] },
    children: [sourceElement],
  };

  const tools: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["md-diagram-tools"] },
    children: [
      actionButton("zoom-out", "−", "Zoom out"),
      actionButton("zoom-in", "+", "Zoom in"),
      actionButton("fit", "Fit", "Fit to view"),
      actionButton("reset", "1:1", "Reset zoom"),
      actionButton("copy-svg", "Copy SVG", "Copy as SVG"),
      actionButton("export-svg", "Export SVG", "Export as SVG"),
    ],
  };

  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["md-diagram"],
      dataLine: String(line),
      dataDiagramIndex: String(index),
      dataDiagramState: "pending",
    },
    children: [tools, stage],
  };
}

export interface ShikiOptions {
  /** Resolved at render time so a theme switch re-highlights. */
  appearance: () => "light" | "dark";
  /** `auto` or an explicit Shiki theme name. */
  theme: () => string;
  wrapLines: () => boolean;
}

interface CodeTarget {
  parent: Parent;
  index: number;
  line: number | undefined;
  language: string;
  code: string;
}

/**
 * Highlight fenced code blocks and add the copy affordance.
 *
 * Highlighting is best effort: an unknown language, an unavailable grammar or a
 * grammar the JavaScript regex engine cannot compile leaves the block as plain
 * escaped text instead of failing the whole render.
 */
export function rehypeShiki(options: ShikiOptions) {
  return async (tree: Root) => {
    const targets: CodeTarget[] = [];

    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;
      // Mermaid blocks have already been replaced by their own plugin.
      if (classList(node).includes("md-diagram-stage")) return;
      const code = findCodeChild(node);
      if (!code) return;
      if (classList(code).includes("language-mermaid")) return;

      const languageClass = classList(code).find((name) => name.startsWith("language-"));
      targets.push({
        parent,
        index,
        line: lineOf(node),
        language: normaliseFenceLanguage(languageClass?.slice("language-".length)),
        code: trimFenceBody(textContent(code)),
      });
    });

    if (targets.length === 0) return;

    const theme = themeForAppearance(options.appearance(), options.theme());
    const highlighter = await getHighlighter();
    const wrapLines = options.wrapLines();

    for (const target of targets) {
      const block = await buildCodeBlock(highlighter, target, theme, wrapLines);
      target.parent.children[target.index] = block;
    }
  };
}

async function buildCodeBlock(
  highlighter: Highlighter | null,
  target: CodeTarget,
  theme: string,
  wrapLines: boolean,
): Promise<Element> {
  const label = target.language === "plaintext" ? "" : target.language;
  let pre: Element | undefined;

  const canHighlight =
    highlighter !== null &&
    isHighlightable(target.language) &&
    target.code.length <= HIGHLIGHT_CHAR_LIMIT &&
    (await ensureLanguage(target.language));

  if (canHighlight && highlighter) {
    try {
      // `ensureLanguage` above already proved the grammar is available.
      const root = highlighter.codeToHast(target.code, { lang: target.language as BundledLanguage, theme });
      pre = root.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "pre",
      );
    } catch (error) {
      console.warn(`Highlighting "${target.language}" failed, rendering plain text instead`, error);
    }
  }

  if (!pre) {
    pre = {
      type: "element",
      tagName: "pre",
      properties: { className: ["md-code-plain"] },
      children: [
        {
          type: "element",
          tagName: "code",
          properties: label ? { className: [`language-${label}`] } : {},
          children: [{ type: "text", value: target.code }],
        },
      ],
    };
  }

  const preProperties: Properties = { ...pre.properties };
  if (label) preProperties.dataLang = label;
  if (wrapLines) preProperties.className = [...classList(pre), "md-code-wrap"];
  pre.properties = preProperties;

  const head: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["md-code-head"] },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["md-code-lang"] },
        children: [{ type: "text", value: label || "text" }],
      },
      {
        type: "element",
        tagName: "button",
        properties: { type: "button", className: ["md-code-copy"], dataCodeAction: "copy", title: "Copy" },
        children: [{ type: "text", value: "Copy" }],
      },
    ],
  };

  const wrapperProperties: Properties = {
    className: label ? ["md-code", `md-code-${label}`] : ["md-code"],
  };
  if (target.line !== undefined) wrapperProperties.dataLine = String(target.line);
  if (label) wrapperProperties.dataLang = label;

  return {
    type: "element",
    tagName: "div",
    properties: wrapperProperties,
    children: [head, pre],
  };
}
