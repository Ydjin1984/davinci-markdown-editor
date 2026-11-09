/**
 * Binds rendered Mermaid containers in the preview to real diagrams.
 *
 * Splitting the work into a synchronous pass and an asynchronous pass matters
 * for perceived speed: diagrams already in the cache appear in the same frame
 * as the rest of the preview, and only genuinely new or changed diagrams wait
 * for Mermaid.
 *
 * Geometry contract (ТЗ §4.2):
 *
 * * The SVG's natural size comes from its `viewBox` and never changes.
 * * There is exactly **one** scaling mechanism: the `width`/`height` attributes
 *   of the SVG, mirrored on the canvas wrapper. No CSS `max-width` and no
 *   `transform`, so fit → 100% → 200% cannot multiply the scale twice.
 * * `fit` is the default and is recomputed by a `ResizeObserver` only while the
 *   block is in `fit` mode; manual zoom is kept until the user chooses `fit`.
 */

import { t } from "@/shared/i18n";
import { cachedDiagram, isDiagramAbort, renderDiagram, type DiagramRenderOptions } from "./renderer";
import {
  parseSvgMarkup,
  prefixSvgIds,
  sanitizeSvgElement,
  svgNaturalSize,
  toStandaloneSvg,
  type SvgSize,
} from "./svg";

const STAGE_CLASS = "md-diagram-stage";
const SOURCE_CLASS = "md-diagram-source";
const VIEWPORT_CLASS = "md-diagram-viewport";
const CANVAS_CLASS = "md-diagram-canvas";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;

interface DiagramBlock extends HTMLElement {
  dataset: DOMStringMap & {
    diagramIndex?: string;
    diagramState?: string;
    diagramZoom?: string;
    diagramMode?: string;
    diagramWidth?: string;
    diagramHeight?: string;
  };
}

export interface HydrateResult {
  /** Diagrams that had to be rendered asynchronously. */
  pending: number;
  /** Diagrams whose source Mermaid rejected. */
  failed: number;
}

/** Read the diagram source back out of the container. */
export function diagramSource(block: HTMLElement): string {
  return block.querySelector<HTMLElement>(`.${SOURCE_CLASS}`)?.textContent ?? "";
}

function stageOf(block: HTMLElement): HTMLElement | null {
  return block.querySelector<HTMLElement>(`.${STAGE_CLASS}`);
}

export function diagramSvg(block: HTMLElement): SVGSVGElement | null {
  return block.querySelector<SVGSVGElement>(`.${VIEWPORT_CLASS} svg`);
}

function naturalSize(block: HTMLElement): SvgSize {
  const width = Number(block.dataset.diagramWidth ?? 0);
  const height = Number(block.dataset.diagramHeight ?? 0);
  if (width > 0 && height > 0) return { width, height };
  const svg = diagramSvg(block);
  return svg ? svgNaturalSize(svg) : { width: 800, height: 600 };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Apply one scale, expressed only through geometry attributes.
 *
 * `mode` is part of the state because the `ResizeObserver` must not fight a
 * manual zoom.
 */
function applyScale(block: DiagramBlock, zoom: number, mode: "fit" | "manual"): void {
  const canvas = block.querySelector<HTMLElement>(`.${CANVAS_CLASS}`);
  const svg = diagramSvg(block);
  if (!canvas || !svg) return;

  const size = naturalSize(block);
  const clamped = mode === "fit" ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : clampZoom(zoom);
  const width = round(size.width * clamped);
  const height = round(size.height * clamped);

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  // Any inline geometry Mermaid left behind would be a second source of truth.
  svg.style.width = "";
  svg.style.height = "";
  svg.style.maxWidth = "none";
  svg.style.transform = "";

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  block.dataset.diagramZoom = String(round(clamped));
  block.dataset.diagramMode = mode;
  block.dataset.diagramState = "ready";
}

/** Fit the diagram to the width of its viewport, never stretching it past 100%. */
export function fitDiagram(block: HTMLElement): void {
  const viewport = block.querySelector<HTMLElement>(`.${VIEWPORT_CLASS}`);
  if (!viewport) return;

  const size = naturalSize(block);
  const available = viewport.clientWidth || viewport.parentElement?.clientWidth || 0;
  if (available <= 0 || size.width <= 0) {
    // Not laid out yet (or hidden): keep the natural size until the observer
    // sees a real width.
    applyScale(block as DiagramBlock, 1, "fit");
    return;
  }

  const zoom = Math.min(1, Math.max(MIN_ZOOM, available / size.width));
  applyScale(block as DiagramBlock, zoom, "fit");
}

/**
 * Set an explicit zoom (20–600%) and switch the block to manual mode.
 *
 * `1` is the 100% button; `fitDiagram` is the separate fit button.
 */
export function applyZoom(block: HTMLElement, zoom: number): void {
  applyScale(block as DiagramBlock, zoom, "manual");
}

const observers = new WeakMap<HTMLElement, ResizeObserver>();

function observeFit(block: DiagramBlock, viewport: HTMLElement): void {
  if (typeof ResizeObserver === "undefined") return;
  observers.get(block)?.disconnect();

  let lastWidth = viewport.clientWidth;
  const observer = new ResizeObserver(() => {
    if (block.dataset.diagramMode !== "fit") return;
    if (!block.isConnected) return;
    const width = viewport.clientWidth;
    // Ignore sub-pixel churn and any loop the scrollbar can cause.
    if (Math.abs(width - lastWidth) < 2) return;
    lastWidth = width;
    fitDiagram(block);
  });
  observer.observe(viewport);
  observers.set(block, observer);
}

let instanceCounter = 0;

/** A prefix that is unique in the document, so a cached SVG can be reused. */
function nextInstancePrefix(): string {
  instanceCounter += 1;
  return `dv${instanceCounter}`;
}

/**
 * Grow the viewBox when Mermaid's own layout puts a label outside it.
 *
 * Mermaid sizes the viewBox from the diagram geometry, and some diagrams (the
 * pie title is the reproducible case) centre text wider than the chart, which
 * clips the label. The SVG is already in the document here, so `getBBox()`
 * reports the real ink extent; the viewBox is widened instead of shrinking the
 * font, so nothing becomes unreadable.
 */
function expandViewBoxToFit(svg: SVGSVGElement): void {
  const parts = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every((value) => Number.isFinite(value))) return;
  const [vx, vy, vw, vh] = parts as [number, number, number, number];
  if (vw <= 0 || vh <= 0) return;

  let bbox: DOMRect;
  try {
    bbox = svg.getBBox();
  } catch {
    return;
  }
  if (!(bbox.width > 0) || !(bbox.height > 0)) return;

  const padding = 12;
  const minX = Math.min(vx, bbox.x - padding);
  const minY = Math.min(vy, bbox.y - padding);
  const maxX = Math.max(vx + vw, bbox.x + bbox.width + padding);
  const maxY = Math.max(vy + vh, bbox.y + bbox.height + padding);

  const unchanged =
    Math.abs(minX - vx) < 0.5 &&
    Math.abs(minY - vy) < 0.5 &&
    Math.abs(maxX - (vx + vw)) < 0.5 &&
    Math.abs(maxY - (vy + vh)) < 0.5;
  if (unchanged) return;

  svg.setAttribute("viewBox", `${round(minX)} ${round(minY)} ${round(maxX - minX)} ${round(maxY - minY)}`);
}

/** Insert rendered SVG markup, sanitise it, give it unique ids and fit it. */
function insertSvg(block: DiagramBlock, markup: string): void {
  const stage = stageOf(block);
  if (!stage) return;

  const svg = parseSvgMarkup(markup);
  if (!svg) return;

  sanitizeSvgElement(svg);
  prefixSvgIds(svg, nextInstancePrefix());
  svg.removeAttribute("style");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const canvas = document.createElement("div");
  canvas.className = CANVAS_CLASS;

  const viewport = document.createElement("div");
  viewport.className = VIEWPORT_CLASS;

  canvas.appendChild(svg);
  viewport.appendChild(canvas);
  stage.replaceChildren(viewport);

  // Must run while the SVG is laid out: `getBBox()` needs the real ink extent.
  expandViewBoxToFit(svg);

  const size = svgNaturalSize(svg);
  block.dataset.diagramWidth = String(round(size.width));
  block.dataset.diagramHeight = String(round(size.height));
  block.dataset.diagramState = "ready";

  fitDiagram(block);
  observeFit(block, viewport);
}

function insertError(
  block: DiagramBlock,
  message: string,
  line: number | null,
  documentLine: number | null,
): void {
  const stage = stageOf(block);
  if (!stage) return;

  const card = document.createElement("div");
  card.className = "md-diagram-error";

  const title = document.createElement("p");
  title.className = "md-diagram-error-title";
  title.textContent = t("mermaid.error");

  const body = document.createElement("pre");
  body.className = "md-diagram-error-body";
  const location =
    line !== null
      ? `${t("mermaid.line", { line })} — `
      : documentLine !== null
        ? `${t("mermaid.documentLine", { line: documentLine })} — `
        : "";
  body.textContent = `${location}${message}`;

  card.append(title, body);

  // Keep the diagram source visible so it stays editable and copyable.
  const source = block.querySelector<HTMLElement>(`.${SOURCE_CLASS}`);
  stage.replaceChildren(card);
  if (source) {
    source.hidden = false;
    stage.appendChild(source);
  }

  block.dataset.diagramState = "error";
  observers.get(block)?.disconnect();
}

/**
 * Render every diagram inside `container`.
 *
 * Returns as soon as the synchronous pass is done; the asynchronous work
 * continues in the background and is abandoned if `abortSignal` fires, which is
 * how a stale render is prevented from overwriting a newer one.
 */
export function hydrateDiagrams(
  container: HTMLElement,
  options: DiagramRenderOptions,
  abortSignal: AbortSignal,
  onSettled?: () => void,
): HydrateResult {
  const blocks = Array.from(container.querySelectorAll<DiagramBlock>(".md-diagram"));
  const pending: DiagramBlock[] = [];

  for (const block of blocks) {
    const source = diagramSource(block);
    if (!source.trim()) continue;

    const cached = cachedDiagram(source, options);
    if (cached !== undefined) {
      insertSvg(block, cached);
      continue;
    }

    block.dataset.diagramState = "pending";
    pending.push(block);
  }

  if (pending.length === 0) {
    return { pending: 0, failed: 0 };
  }

  // Mutable on purpose: the caller sees the same object after the async pass
  // settles, so `failed` reports the outcome instead of always being 0.
  const result: HydrateResult = { pending: pending.length, failed: 0 };

  void (async () => {
    // Sequential: Mermaid keeps global state, so parallel renders interleave
    // badly and a slow diagram would starve the rest. The renderer's own queue
    // additionally serialises the initialize+render pair across passes.
    for (const block of pending) {
      if (abortSignal.aborted) return;
      if (!block.isConnected) continue;

      const source = diagramSource(block);
      const documentLine = Number(block.dataset.diagramLine ?? block.getAttribute("data-line") ?? 0) || null;

      try {
        const rendered = await renderDiagram(source, options, abortSignal);

        // A newer pass owns the container now: publishing would resurrect a
        // diagram that no longer matches the document.
        if (abortSignal.aborted || !block.isConnected) return;

        if (rendered.ok) {
          insertSvg(block, rendered.svg);
        } else {
          result.failed += 1;
          insertError(block, rendered.message, rendered.line, documentLine);
        }
      } catch (error) {
        // Cancelled renders are not failures: the block stays for the newer pass.
        if (isDiagramAbort(error)) return;
        if (abortSignal.aborted || !block.isConnected) return;
        result.failed += 1;
        insertError(block, String(error), null, documentLine);
      }
    }

    onSettled?.();
  })();

  return result;
}

/** Produce a standalone SVG document suitable for saving to a file. */
export function standaloneSvg(block: HTMLElement): string | null {
  const svg = diagramSvg(block);
  if (!svg) return null;
  return toStandaloneSvg(svg, naturalSize(block));
}
