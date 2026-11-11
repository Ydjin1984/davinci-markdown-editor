/**
 * Mermaid render lab.
 *
 * A development-only page that renders every Insert → Diagram template plus the
 * kit examples (`diagrams.md`, `invalid-diagram.md`) through the *real* preview
 * pipeline and the *real* Mermaid renderer. It exists so a browser check can
 * assert facts a unit test cannot: computed fills, unique DOM ids, resolved
 * arrow markers, unclipped labels and the single-source-of-scaling geometry.
 *
 * It is served by Vite from `src/dev/renderLab.html` and is not referenced from
 * `index.html`, so it never enters the production bundle.
 *
 * Everything the CDP check needs is exposed on `window.__renderLab` and the last
 * report is also available as `window.__renderLabReport`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "katex/dist/katex.min.css";
import "../styles/global.css";
import "../styles/markdown.css";

import { renderMarkdown } from "@/markdown/renderer/pipeline";
import { applyZoom, fitDiagram, hydrateDiagrams, standaloneSvg } from "@/mermaid/hydrate";
import { DIAGRAM_TEMPLATES, fencedDiagram } from "@/mermaid/templates";
import type { Appearance } from "@/mermaid/theme";
import diagramsFixture from "./fixtures/diagrams.md?raw";
import invalidFixture from "./fixtures/invalid-diagram.md?raw";
import renderTzFixture from "./fixtures/render-tz.md?raw";

type ZoomAction = "fit" | "100" | "200";

interface FillSample {
  labCase: string;
  label: string;
  fill: string;
  stroke: string;
  textFill: string;
}

interface SizeSample {
  labCase: string;
  mode: string;
  zoom: string;
  widthAttr: number | null;
  heightAttr: number | null;
  rectWidth: number;
  canvasWidth: string;
  svgTransform: string;
  canvasTransform: string;
}

interface ClipIssue {
  labCase: string;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
}

interface ArrowSample {
  labCase: string;
  total: number;
  resolved: number;
  broken: string[];
}

interface LabReport {
  appearance: Appearance;
  total: number;
  states: Record<string, number>;
  labCases: string[];
  ready: boolean;
  duplicateIds: string[];
  unprefixedIds: string[];
  fills: FillSample[];
  uniqueFills: string[];
  clippedLabels: ClipIssue[];
  invisibleLabels: Array<{ labCase: string; text: string; fill: string; opacity: string }>;
  arrows: ArrowSample[];
  pairOverlapIds: string[];
  sizes: SizeSample[];
  standalone: {
    labCase: string;
    bytes: number;
    hasXmlns: boolean;
    hasViewBox: boolean;
    hasPalette: boolean;
  } | null;
  checkedAt: string;
}

interface RenderLabApi {
  setAppearance: (appearance: Appearance) => void;
  setZoom: (action: ZoomAction) => SizeSample[];
  report: () => LabReport | null;
  standalone: (labCase: string) => string | null;
  refresh: () => LabReport | null;
  templates: Array<{ id: string; labelKey: string; label: string; hint: string }>;
}

declare global {
  interface Window {
    __renderLab?: RenderLabApi;
    __renderLabReport?: LabReport | null;
  }
}

const LAB_THEME = "davinci" as const;

/** The document the lab renders: templates, kit diagrams, one broken diagram. */
function buildDocument(): string {
  const parts: string[] = ["# Стенд рендера Mermaid", ""];

  for (const template of DIAGRAM_TEMPLATES) {
    parts.push(`## Шаблон: ${template.id}`, "", fencedDiagram(template).trimEnd(), "");
  }

  parts.push("## Комплект: diagrams.md", "", diagramsFixture.trimEnd(), "");
  parts.push("## Комплект: invalid-diagram.md", "", invalidFixture.trimEnd(), "");
  parts.push("## ТЗ: render-tz.md", "", renderTzFixture.trimEnd(), "");

  return parts.join("\n");
}

/** Attach a stable `data-lab-case` to every diagram block in document order. */
function tagCases(container: HTMLElement): void {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(".md-diagram"));
  blocks.forEach((block, index) => {
    const template = DIAGRAM_TEMPLATES[index];
    block.dataset.labCase = template
      ? `template:${template.id}`
      : `fixture:${index - DIAGRAM_TEMPLATES.length}`;
  });
}

function svgOf(block: Element | null | undefined): SVGSVGElement | null {
  return block?.querySelector<SVGSVGElement>(".md-diagram-viewport svg") ?? null;
}

function blocksByCase(container: HTMLElement): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  for (const block of Array.from(container.querySelectorAll<HTMLElement>(".md-diagram"))) {
    const labCase = block.dataset.labCase;
    if (labCase) map.set(labCase, block);
  }
  return map;
}

/** Normalise `rgb(21, 45, 72)` to `#152d48` so samples are comparable to the palette. */
function normaliseColour(value: string): string {
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value.trim());
  if (!rgb) return value.trim().toLowerCase();
  const [, r, g, b] = rgb;
  return `#${Number(r).toString(16).padStart(2, "0")}${Number(g).toString(16).padStart(2, "0")}${Number(b).toString(16).padStart(2, "0")}`;
}

function shapeOf(node: Element): SVGGraphicsElement | null {
  return node.querySelector<SVGGraphicsElement>("rect, path, circle, polygon, ellipse");
}

function collectFills(container: HTMLElement): FillSample[] {
  const samples: FillSample[] = [];
  for (const [labCase, block] of blocksByCase(container)) {
    const svg = svgOf(block);
    if (!svg) continue;
    const nodes = Array.from(svg.querySelectorAll<SVGGElement>("g.node"));
    for (const node of nodes.slice(0, 12)) {
      const shape = shapeOf(node);
      const text = node.querySelector("text");
      if (!shape) continue;
      const shapeStyle = getComputedStyle(shape);
      samples.push({
        labCase,
        label: (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
        fill: normaliseColour(shapeStyle.fill),
        stroke: normaliseColour(shapeStyle.stroke),
        textFill: text ? normaliseColour(getComputedStyle(text).fill) : "",
      });
    }
  }
  return samples;
}

function collectIds(container: HTMLElement): { duplicates: string[]; unprefixed: string[] } {
  const counts = new Map<string, number>();
  const unprefixed = new Set<string>();

  // Only SVG ids matter here: heading ids come from `rehype-slug` and are not
  // produced by Mermaid, so they are not part of the uniqueness contract.
  for (const svg of Array.from(container.querySelectorAll("svg"))) {
    for (const element of [svg, ...Array.from(svg.querySelectorAll("[id]"))]) {
      const id = element.getAttribute("id") ?? "";
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!/^dv\d+-/.test(id)) unprefixed.add(id);
    }
  }

  return {
    duplicates: [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
    unprefixed: [...unprefixed],
  };
}

function collectLabels(container: HTMLElement): {
  clipped: ClipIssue[];
  invisible: Array<{ labCase: string; text: string; fill: string; opacity: string }>;
} {
  const clipped: ClipIssue[] = [];
  const invisible: Array<{ labCase: string; text: string; fill: string; opacity: string }> = [];

  for (const [labCase, block] of blocksByCase(container)) {
    const svg = svgOf(block);
    if (!svg) continue;
    // Screen coordinates: `getBBox()` is local to the text's own transform,
    // which Mermaid uses heavily, so it cannot be compared to the viewBox.
    const surface = svg.getBoundingClientRect();
    const tolerance = 1.5;

    for (const text of Array.from(svg.querySelectorAll<SVGTextElement>("text"))) {
      const value = (text.textContent ?? "").trim();
      if (!value) continue;
      const style = getComputedStyle(text);
      const opacity = Number.parseFloat(style.opacity || "1");
      if (style.fill === "none" || opacity === 0) {
        invisible.push({ labCase, text: value.slice(0, 40), fill: style.fill, opacity: style.opacity });
      }

      const bbox = text.getBoundingClientRect();
      if (bbox.width <= 0 || bbox.height <= 0) {
        clipped.push({
          labCase,
          text: value.slice(0, 40),
          bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        });
        continue;
      }

      if (
        bbox.left < surface.left - tolerance ||
        bbox.top < surface.top - tolerance ||
        bbox.right > surface.right + tolerance ||
        bbox.bottom > surface.bottom + tolerance
      ) {
        clipped.push({
          labCase,
          text: value.slice(0, 40),
          bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        });
      }
    }
  }

  return { clipped, invisible };
}

function collectArrows(container: HTMLElement): ArrowSample[] {
  const result: ArrowSample[] = [];
  for (const [labCase, block] of blocksByCase(container)) {
    const svg = svgOf(block);
    if (!svg) continue;
    const broken: string[] = [];
    let total = 0;
    let resolved = 0;
    for (const element of Array.from(svg.querySelectorAll<SVGElement>("[marker-end], [marker-start]"))) {
      for (const attribute of ["marker-end", "marker-start"]) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        total += 1;
        const match = /url\(\s*#([^)\s"']+)\s*\)/.exec(value);
        if (!match) {
          broken.push(value);
          continue;
        }
        const id = match[1]!;
        const target = svg.querySelector(`#${CSS.escape(id)}`);
        if (target) resolved += 1;
        else broken.push(value);
      }
    }
    result.push({ labCase, total, resolved, broken });
  }
  return result;
}

/** Ids shared by the two identical flowcharts of diagrams.md (must be none). */
function collectPairOverlap(container: HTMLElement): string[] {
  const first = blocksByCase(container).get("fixture:0");
  const second = blocksByCase(container).get("fixture:1");
  if (!first || !second) return [];

  const idsOf = (block: HTMLElement): Set<string> => {
    const svg = svgOf(block);
    if (!svg) return new Set();
    return new Set(
      [svg, ...Array.from(svg.querySelectorAll("[id]"))]
        .map((element) => element.getAttribute("id"))
        .filter((id): id is string => Boolean(id)),
    );
  };

  const a = idsOf(first);
  const b = idsOf(second);
  return [...b].filter((id) => a.has(id));
}

function collectSizes(container: HTMLElement): SizeSample[] {
  const sizes: SizeSample[] = [];
  for (const [labCase, block] of blocksByCase(container)) {
    const svg = svgOf(block);
    if (!svg) continue;
    const canvas = block.querySelector<HTMLElement>(".md-diagram-canvas");
    const rect = svg.getBoundingClientRect();
    sizes.push({
      labCase,
      mode: block.dataset.diagramMode ?? "",
      zoom: block.dataset.diagramZoom ?? "",
      widthAttr: svg.hasAttribute("width") ? Number(svg.getAttribute("width")) : null,
      heightAttr: svg.hasAttribute("height") ? Number(svg.getAttribute("height")) : null,
      rectWidth: Math.round(rect.width * 100) / 100,
      canvasWidth: canvas?.style.width ?? "",
      svgTransform: getComputedStyle(svg).transform,
      canvasTransform: canvas ? getComputedStyle(canvas).transform : "",
    });
  }
  return sizes;
}

function collectStandalone(container: HTMLElement): LabReport["standalone"] {
  const block = blocksByCase(container).get("template:flowchart");
  if (!block) return null;
  const svg = standaloneSvg(block);
  if (!svg) return null;
  return {
    labCase: "template:flowchart",
    bytes: new TextEncoder().encode(svg).length,
    hasXmlns: svg.includes('xmlns="http://www.w3.org/2000/svg"'),
    hasViewBox: /viewBox="[^"]+"/.test(svg),
    // Mermaid writes its palette into an SVG <style> block; the export keeps it.
    hasPalette: /<style/.test(svg) && /fill:/.test(svg),
  };
}

function collectReport(container: HTMLElement, appearance: Appearance): LabReport {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(".md-diagram"));
  const states: Record<string, number> = {};
  for (const block of blocks) {
    const state = block.dataset.diagramState ?? "unknown";
    states[state] = (states[state] ?? 0) + 1;
  }

  const { duplicates, unprefixed } = collectIds(container);
  const fills = collectFills(container);
  const { clipped, invisible } = collectLabels(container);
  const arrows = collectArrows(container);
  const sizes = collectSizes(container);

  return {
    appearance,
    total: blocks.length,
    states,
    labCases: blocks.map((block) => block.dataset.labCase ?? "?"),
    ready: blocks.length > 0 && blocks.every((block) => block.dataset.diagramState === "ready"),
    duplicateIds: duplicates,
    unprefixedIds: unprefixed,
    fills,
    uniqueFills: [...new Set(fills.map((sample) => sample.fill))].sort(),
    clippedLabels: clipped,
    invisibleLabels: invisible,
    arrows,
    pairOverlapIds: collectPairOverlap(container),
    sizes,
    standalone: collectStandalone(container),
    checkedAt: new Date().toISOString(),
  };
}

function setZoomAll(container: HTMLElement, action: ZoomAction): SizeSample[] {
  for (const block of Array.from(container.querySelectorAll<HTMLElement>(".md-diagram"))) {
    if (action === "fit") fitDiagram(block);
    else applyZoom(block, action === "100" ? 1 : 2);
  }
  return collectSizes(container);
}

function Lab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [appearance, setAppearance] = useState<Appearance>("dark");
  const [status, setStatus] = useState("Рендер…");
  const [report, setReport] = useState<LabReport | null>(null);
  const appearanceRef = useRef<Appearance>(appearance);

  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const publish = useCallback((container: HTMLElement) => {
    const next = collectReport(container, appearanceRef.current);
    container.dataset.labReady = String(next.ready);
    window.__renderLabReport = next;
    setReport(next);
    setStatus(`Готово: ${next.total} схем, состояния ${JSON.stringify(next.states)}`);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new AbortController();
    let cancelled = false;
    setStatus(`Рендер (${appearance})…`);

    void (async () => {
      const { html } = await renderMarkdown(buildDocument(), {
        allowRawHtml: true,
        renderMath: true,
        headingAnchors: false,
        appearance,
      });
      if (cancelled) return;

      container.innerHTML = html;
      tagCases(container);

      const result = hydrateDiagrams(container, { appearance, theme: LAB_THEME }, controller.signal, () => {
        if (!cancelled) publish(container);
      });
      setStatus(`Ожидают Mermaid: ${result.pending}`);

      if (result.pending === 0) publish(container);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [appearance, publish]);

  useEffect(() => {
    window.__renderLab = {
      setAppearance: (next) => setAppearance(next),
      setZoom: (action) => {
        const container = containerRef.current;
        return container ? setZoomAll(container, action) : [];
      },
      report: () => {
        const container = containerRef.current;
        return container ? collectReport(container, appearanceRef.current) : null;
      },
      standalone: (labCase) => {
        const container = containerRef.current;
        const block = container ? blocksByCase(container).get(labCase) : undefined;
        return block ? standaloneSvg(block) : null;
      },
      refresh: () => {
        const container = containerRef.current;
        if (!container) return null;
        publish(container);
        return window.__renderLabReport ?? null;
      },
      templates: DIAGRAM_TEMPLATES.map((template) => ({
        id: template.id,
        labelKey: template.labelKey,
        label: template.label,
        hint: template.hint,
      })),
    };
  }, [publish]);

  return (
    <div className="render-lab">
      <aside className="render-lab__panel">
        <h1>Render lab</h1>
        <p className="render-lab__hint">
          Стенд Mermaid: все шаблоны, diagrams.md и сломанная схема. Только разработка.
        </p>
        <div className="render-lab__row">
          <button type="button" onClick={() => setAppearance("dark")} data-lab-action="appearance-dark">
            Тёмная
          </button>
          <button type="button" onClick={() => setAppearance("light")} data-lab-action="appearance-light">
            Светлая
          </button>
        </div>
        <div className="render-lab__row">
          <button
            type="button"
            data-lab-action="zoom-fit"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                setZoomAll(container, "fit");
                publish(container);
              }
            }}
          >
            Вписать
          </button>
          <button
            type="button"
            data-lab-action="zoom-100"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                setZoomAll(container, "100");
                publish(container);
              }
            }}
          >
            100%
          </button>
          <button
            type="button"
            data-lab-action="zoom-200"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                setZoomAll(container, "200");
                publish(container);
              }
            }}
          >
            200%
          </button>
        </div>
        <p className="render-lab__status" data-lab-status>
          {status}
        </p>
        <h2>Отчёт</h2>
        <pre className="render-lab__report" data-lab-report>
          {report ? JSON.stringify(report, null, 2) : "…"}
        </pre>
      </aside>

      <main className="render-lab__canvas">
        <div
          className={`markdown-body markdown-body--${appearance} render-lab__body`}
          ref={containerRef}
          data-lab-appearance={appearance}
        />
      </main>
    </div>
  );
}

const mount = document.getElementById("render-lab");
if (!mount) {
  throw new Error("the render-lab root element is missing from renderLab.html");
}

createRoot(mount).render(<Lab />);
