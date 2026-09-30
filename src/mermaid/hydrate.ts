/**
 * Binds rendered Mermaid containers in the preview to real diagrams.
 *
 * Splitting the work into a synchronous pass and an asynchronous pass matters
 * for perceived speed: diagrams already in the cache appear in the same frame
 * as the rest of the preview, and only genuinely new or changed diagrams wait
 * for Mermaid.
 */

import { cachedDiagram, renderDiagram, type DiagramRenderOptions } from "./renderer";
import { t } from "@/shared/i18n";

const STAGE_CLASS = "md-diagram-stage";
const SOURCE_CLASS = "md-diagram-source";

interface DiagramBlock extends HTMLElement {
  dataset: DOMStringMap & {
    diagramIndex?: string;
    diagramState?: string;
    diagramZoom?: string;
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

/** Natural size of the diagram, taken from the SVG viewBox. */
function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
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

/** Wrap the SVG so zoom and pan can be controlled by CSS transforms. */
function buildViewport(svg: SVGSVGElement): {
  viewport: HTMLElement;
  canvas: HTMLElement;
  size: { width: number; height: number };
} {
  const size = naturalSize(svg);

  const canvas = document.createElement("div");
  canvas.className = "md-diagram-canvas";

  const viewport = document.createElement("div");
  viewport.className = "md-diagram-viewport";

  svg.removeAttribute("style");
  svg.setAttribute("width", String(size.width));
  svg.setAttribute("height", String(size.height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  canvas.appendChild(svg);
  viewport.appendChild(canvas);

  return { viewport, canvas, size };
}

/** Apply a zoom factor, switching from responsive to fixed sizing when needed. */
export function applyZoom(block: HTMLElement, zoom: number): void {
  const canvas = block.querySelector<HTMLElement>(".md-diagram-canvas");
  const svg = block.querySelector<SVGSVGElement>(".md-diagram-viewport svg");
  if (!canvas || !svg) return;

  const width = Number(block.dataset.diagramWidth ?? 0);
  const height = Number(block.dataset.diagramHeight ?? 0);
  if (width <= 0 || height <= 0) return;

  const clamped = Math.min(Math.max(zoom, 0.2), 6);
  block.dataset.diagramZoom = String(clamped);

  if (Math.abs(clamped - 1) < 0.001) {
    svg.removeAttribute("style");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    canvas.style.width = "";
    canvas.style.height = "";
  } else {
    svg.style.transform = `scale(${clamped})`;
    svg.style.transformOrigin = "0 0";
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    canvas.style.position = "relative";
    canvas.style.width = `${width * clamped}px`;
    canvas.style.height = `${height * clamped}px`;
  }

  block.dataset.diagramState = "ready";
}

function insertSvg(block: DiagramBlock, svgMarkup: string): void {
  const stage = stageOf(block);
  if (!stage) return;

  const template = document.createElement("template");
  template.innerHTML = svgMarkup.trim();
  const svg = template.content.querySelector("svg");
  if (!svg) return;

  const { viewport, size } = buildViewport(svg as SVGSVGElement);
  stage.replaceChildren(viewport);

  block.dataset.diagramWidth = String(size.width);
  block.dataset.diagramHeight = String(size.height);
  block.dataset.diagramState = "ready";
  applyZoom(block, 1);
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
        ? `Line ${documentLine} — `
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
  let failed = 0;

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

  void (async () => {
    // Sequential: Mermaid keeps global state, so parallel renders interleave
    // badly and a slow diagram would starve the rest.
    for (const block of pending) {
      if (abortSignal.aborted) return;
      if (!block.isConnected) continue;

      const source = diagramSource(block);
      const documentLine = Number(block.dataset.diagramLine ?? block.getAttribute("data-line") ?? 0) || null;
      const result = await renderDiagram(source, options);

      if (abortSignal.aborted || !block.isConnected) return;

      if (result.ok) {
        insertSvg(block, result.svg);
      } else {
        failed += 1;
        insertError(block, result.message, result.line, documentLine);
      }
    }
    onSettled?.();
  })();

  return { pending: pending.length, failed };
}

/** Fit the diagram to the width of its viewport. */
export function fitDiagram(block: HTMLElement): void {
  const viewport = block.querySelector<HTMLElement>(".md-diagram-viewport");
  const width = Number(block.dataset.diagramWidth ?? 0);
  if (!viewport || width <= 0) return;

  const available = viewport.clientWidth || viewport.parentElement?.clientWidth || width;
  applyZoom(block, available / width);
}

export function diagramSvg(block: HTMLElement): SVGSVGElement | null {
  return block.querySelector<SVGSVGElement>(".md-diagram-viewport svg");
}

/** Produce a standalone SVG document suitable for saving to a file. */
export function standaloneSvg(block: HTMLElement): string | null {
  const svg = diagramSvg(block);
  if (!svg) return null;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.removeAttribute("class");
  const width = Number(block.dataset.diagramWidth ?? 0);
  const height = Number(block.dataset.diagramHeight ?? 0);
  if (width > 0 && height > 0) {
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
  }
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}\n`;
}
