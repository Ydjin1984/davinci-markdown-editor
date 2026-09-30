/**
 * Mermaid diagram rendering for the preview.
 *
 * Three properties this module has to guarantee:
 *
 * 1. **A broken diagram never breaks the document.** Each block is rendered in
 *    isolation; a failure becomes an error card and the rest of the preview is
 *    untouched.
 * 2. **A stale asynchronous render never overwrites a newer one.** Every pass
 *    takes a generation number and re-checks it before touching the DOM.
 * 3. **Unchanged diagrams are not re-rendered on every keystroke.** Results are
 *    cached by (theme, source), so typing elsewhere in the document costs
 *    nothing for the diagrams already on screen.
 */

import type { MermaidTheme } from "@/shared/types";

type MermaidApi = typeof import("mermaid").default;

export interface DiagramRenderOptions {
  appearance: "light" | "dark";
  theme: MermaidTheme;
}

const CACHE_LIMIT = 80;
const RENDER_TIMEOUT_MS = 15_000;

const cache = new Map<string, string>();

let mermaidPromise: Promise<MermaidApi> | null = null;
let initialisedKey: string | null = null;
let renderCounter = 0;

function cacheKey(source: string, theme: string): string {
  return `${theme}\u0000${source}`;
}

function cacheGet(key: string): string | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    // Refresh recency for the simple LRU eviction below.
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

function cacheSet(key: string, value: string): void {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearDiagramCache(): void {
  cache.clear();
}

/** Resolve the effective Mermaid theme for the current appearance. */
export function effectiveMermaidTheme(appearance: "light" | "dark", theme: MermaidTheme): string {
  if (theme !== "auto") return theme;
  return appearance === "dark" ? "dark" : "default";
}

async function getMermaid(options: DiagramRenderOptions): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidPromise;

  const theme = effectiveMermaidTheme(options.appearance, options.theme);
  const key = `${theme}|${options.appearance}`;

  if (initialisedKey !== key) {
    mermaid.initialize({
      startOnLoad: false,
      // Mermaid sanitises its own output and refuses `click` handlers that
      // would run script, so a document cannot turn a diagram into code.
      securityLevel: "strict",
      // Prevents Mermaid from injecting its own error graphic into the page;
      // we render our own card that keeps the source visible.
      suppressErrorRendering: true,
      theme: theme as never,
      // Labels as SVG <text> rather than <foreignObject>, so an exported SVG
      // opens correctly in viewers that do not embed HTML.
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      class: { htmlLabels: false },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      er: { useMaxWidth: true },
      journey: { useMaxWidth: true },
      gitGraph: { useMaxWidth: true },
      pie: { useMaxWidth: true },
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    });
    initialisedKey = key;
  }

  return mermaid;
}

interface RenderSuccess {
  ok: true;
  svg: string;
}

interface RenderFailure {
  ok: false;
  message: string;
  line: number | null;
}

export type RenderResult = RenderSuccess | RenderFailure;

function nextRenderId(): string {
  renderCounter += 1;
  return `davinci-mermaid-${Date.now().toString(36)}-${renderCounter}`;
}

/** Strip anything that would make the SVG unsafe or non-portable. */
function sanitiseSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

/** Pull a line number out of Mermaid's parse error text when it is present. */
function extractLine(message: string): number | null {
  const match = /line\s+(\d+)/i.exec(message);
  if (match) return Number(match[1]);
  const caret = /^\s*(\d+)\s*\|/m.exec(message);
  if (caret) return Number(caret[1]);
  return null;
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "str" in error) {
    return String((error as { str: unknown }).str);
  }
  return String(error);
}

async function renderWithTimeout(mermaid: MermaidApi, id: string, source: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      mermaid.render(id, source),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The diagram took too long to render.")),
          RENDER_TIMEOUT_MS,
        );
      }),
    ]);
    return result.svg;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Mermaid measures the diagram using a temporary element; make sure a
    // failed render does not leave it behind.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Render one Mermaid source to SVG, using the cache when possible. */
export async function renderDiagram(source: string, options: DiagramRenderOptions): Promise<RenderResult> {
  const theme = effectiveMermaidTheme(options.appearance, options.theme);
  const key = cacheKey(source, theme);

  const cached = cacheGet(key);
  if (cached !== undefined) {
    return { ok: true, svg: cached };
  }

  try {
    const mermaid = await getMermaid(options);
    const svg = sanitiseSvg(await renderWithTimeout(mermaid, nextRenderId(), source));
    cacheSet(key, svg);
    return { ok: true, svg };
  } catch (error) {
    const message = describeError(error);
    return { ok: false, message, line: extractLine(message) };
  }
}

/** Cached SVG for a source, if a previous render produced one. */
export function cachedDiagram(source: string, options: DiagramRenderOptions): string | undefined {
  return cacheGet(cacheKey(source, effectiveMermaidTheme(options.appearance, options.theme)));
}
