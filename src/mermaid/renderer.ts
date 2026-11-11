/**
 * Mermaid diagram rendering for the preview.
 *
 * Four properties this module has to guarantee:
 *
 * 1. **A broken diagram never breaks the document.** Each block is rendered in
 *    isolation; a failure becomes an error card and the rest of the preview is
 *    untouched.
 * 2. **A stale asynchronous render never overwrites a newer one.** Every render
 *    takes an abort signal and a generation number; a cancelled task refuses to
 *    hand back its SVG.
 * 3. **Unchanged diagrams are not re-rendered on every keystroke.** Results are
 *    cached by a key that covers every input Mermaid actually reads: the source,
 *    the effective theme, the appearance, the palette version, the layout
 *    options and the renderer version.
 * 4. **Mermaid's global configuration is never mutated mid-render.** A single
 *    serial queue owns the `initialize` + `render` pair.
 */

import type { MermaidConfig } from "mermaid";

import type { MermaidTheme } from "@/shared/types";
import { DiagramTaskAbortedError, diagramQueue, isDiagramAbort } from "./queue";
import { improveOrthogonalRoutes } from "./route/svg";
import { DIAGRAM_FONT_FAMILY, PALETTE_VERSION, davinciTheme, type Appearance } from "./theme";

type MermaidApi = typeof import("mermaid").default;

export interface DiagramRenderOptions {
  appearance: Appearance;
  theme: MermaidTheme;
}

/** Bumped when rendering logic changes in a way that changes the SVG. */
export const RENDER_VERSION = "render-5";

/**
 * Layout options that change the SVG. They are part of the cache key, so adding
 * one here can never reuse an SVG produced with different geometry.
 */
const LAYOUT_VERSION = "layout-3";
const LAYOUT_OPTIONS = {
  htmlLabels: false,
  useMaxWidth: false,
  // Flowchart geometry. `curve: "step"` makes Mermaid draw right-angled
  // polylines instead of its default `basis` curves, and the spacings leave
  // room for edge labels. The ports and corridors themselves are rebuilt by
  // `route/` after the render (see `improveOrthogonalRoutes`): dagre's
  // centre-to-centre routes run under labels and share segments.
  flowchart: {
    curve: "step",
    nodeSpacing: 56,
    rankSpacing: 76,
    padding: 16,
  },
} as const;
const CACHE_LIMIT = 80;
const RENDER_TIMEOUT_MS = 15_000;

const cache = new Map<string, string>();

let mermaidPromise: Promise<MermaidApi> | null = null;
let initialisedKey: string | null = null;
let renderCounter = 0;

/** Resolve the effective Mermaid theme for the current appearance. */
export function effectiveMermaidTheme(appearance: Appearance, theme: MermaidTheme): string {
  // The theme *name* does not depend on the appearance — DaVinci is one palette
  // whose colours are swapped through `themeVariables` — but the appearance is
  // still part of the signature because it is part of the cache key.
  void appearance;
  // `auto` means "follow the app", and the app's palette is DaVinci.
  if (theme === "auto") return "davinci";
  return theme;
}

/**
 * Cache key: every input that can change the produced SVG.
 *
 * Exported because the tests assert that the appearance and the palette version
 * are part of the key — a stale colour after a theme switch is exactly the bug
 * this key exists to prevent.
 */
export function diagramCacheKey(source: string, options: DiagramRenderOptions): string {
  const theme = effectiveMermaidTheme(options.appearance, options.theme);
  return [RENDER_VERSION, PALETTE_VERSION, LAYOUT_VERSION, options.appearance, theme, source].join("\u0000");
}

function initialisationKey(options: DiagramRenderOptions): string {
  const theme = effectiveMermaidTheme(options.appearance, options.theme);
  return [PALETTE_VERSION, LAYOUT_VERSION, options.appearance, theme].join("|");
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

async function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

/** Build the Mermaid configuration for one appearance/theme pair. */
export function mermaidConfig(options: DiagramRenderOptions): MermaidConfig {
  const theme = effectiveMermaidTheme(options.appearance, options.theme);

  const config: MermaidConfig = {
    startOnLoad: false,
    // Mermaid sanitises its own output and refuses `click` handlers that would
    // run script, so a document cannot turn a diagram into code.
    securityLevel: "strict",
    // Prevents Mermaid from injecting its own error graphic into the page; we
    // render our own card that keeps the source visible.
    suppressErrorRendering: true,
    // Labels as SVG <text> rather than <foreignObject>, so an exported SVG
    // opens correctly in viewers that do not embed HTML.
    htmlLabels: LAYOUT_OPTIONS.htmlLabels,
    fontFamily: DIAGRAM_FONT_FAMILY,
    flowchart: {
      htmlLabels: LAYOUT_OPTIONS.htmlLabels,
      useMaxWidth: LAYOUT_OPTIONS.useMaxWidth,
      ...LAYOUT_OPTIONS.flowchart,
    },
    sequence: { useMaxWidth: LAYOUT_OPTIONS.useMaxWidth },
    gantt: { useMaxWidth: LAYOUT_OPTIONS.useMaxWidth },
    er: { useMaxWidth: LAYOUT_OPTIONS.useMaxWidth },
    journey: { useMaxWidth: LAYOUT_OPTIONS.useMaxWidth },
    gitGraph: { useMaxWidth: LAYOUT_OPTIONS.useMaxWidth },
    pie: { useMaxWidth: LAYOUT_OPTIONS.useMaxWidth },
  };

  if (theme === "davinci") {
    // `base` is the only theme that accepts a full variable set; the DaVinci
    // palette is injected through it plus a narrow `themeCSS` that only repairs
    // label backgrounds.
    const davinci = davinciTheme(options.appearance);
    config.theme = "base";
    config.themeVariables = davinci.themeVariables;
    config.themeCSS = davinci.themeCSS;
  } else {
    config.theme = theme as MermaidConfig["theme"];
  }

  return config;
}

function ensureInitialised(mermaid: MermaidApi, options: DiagramRenderOptions): void {
  const key = initialisationKey(options);
  if (initialisedKey === key) return;
  mermaid.initialize(mermaidConfig(options));
  initialisedKey = key;
}

export interface RenderSuccess {
  ok: true;
  svg: string;
}

export interface RenderFailure {
  ok: false;
  message: string;
  line: number | null;
}

export type RenderResult = RenderSuccess | RenderFailure;

function nextRenderId(): string {
  renderCounter += 1;
  return `davinci-mermaid-${Date.now().toString(36)}-${renderCounter}`;
}

/**
 * Cheap string-level guard, kept as defence in depth in front of the DOM
 * sanitiser in `svg.ts`. It must not touch `<style>`: the palette lives there.
 */
function stripUnsafeMarkup(svg: string): string {
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
    // failed render does not leave it behind, including after a timeout that
    // Mermaid itself ignored.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * Render one Mermaid source to SVG, using the cache when possible.
 *
 * The `initialize` + `render` pair runs as a single queued task. If `signal`
 * aborts while the task is queued or running the returned promise rejects with
 * `DiagramTaskAbortedError`, so a late SVG can never be published.
 */
export async function renderDiagram(
  source: string,
  options: DiagramRenderOptions,
  signal?: AbortSignal,
): Promise<RenderResult> {
  const key = diagramCacheKey(source, options);

  if (!signal?.aborted) {
    const cached = cacheGet(key);
    if (cached !== undefined) {
      return { ok: true, svg: cached };
    }
  }

  try {
    const svg = stripUnsafeMarkup(
      improveOrthogonalRoutes(
        await diagramQueue.enqueue(async () => {
          const mermaid = await loadMermaid();
          ensureInitialised(mermaid, options);
          return renderWithTimeout(mermaid, nextRenderId(), source);
        }, signal),
      ),
    );

    if (signal?.aborted) throw new DiagramTaskAbortedError();

    cacheSet(key, svg);
    return { ok: true, svg };
  } catch (error) {
    if (isDiagramAbort(error)) throw error;
    const message = describeError(error);
    return { ok: false, message, line: extractLine(message) };
  }
}

/** Cached SVG for a source, if a previous render produced one. */
export function cachedDiagram(source: string, options: DiagramRenderOptions): string | undefined {
  return cacheGet(diagramCacheKey(source, options));
}

/** Re-exported so callers do not need to import the queue module separately. */
export { isDiagramAbort };
