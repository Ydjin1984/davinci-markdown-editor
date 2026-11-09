// @vitest-environment jsdom
/** SVG safety, id prefixing and standalone export — pure DOM utilities. */

import { describe, expect, it } from "vitest";

import {
  parseSvgMarkup,
  prefixSvgIds,
  sanitizeSvgElement,
  svgNaturalSize,
  toStandaloneSvg,
} from "@/mermaid/svg";

const MARKUP = `<svg id="mermaid-1" viewBox="0 0 200 100" width="100%" height="100%" style="max-width: 200px;">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8"><path d="M0 0L8 4L0 8Z" fill="#94a3b8"/></marker>
    <clipPath id="clip"><rect width="10" height="10"/></clipPath>
  </defs>
  <style>#mermaid-1 .node rect { fill: #152d48; }</style>
  <g class="node">
    <rect fill="url(#clip)" marker-end="url(#arrow)"/>
    <text id="label-1" aria-labelledby="label-1">Модель документа</text>
  </g>
  <g><path marker-end="url(#arrow)" clip-path="url(#clip)"/></g>
  <a href="#label-1"><text>Ссылка</text></a>
</svg>`;

function parsed(): SVGSVGElement {
  const svg = parseSvgMarkup(MARKUP);
  if (!svg) throw new Error("the fixture did not parse as an SVG");
  return svg;
}

describe("parseSvgMarkup", () => {
  it("parses Mermaid's output into a detached SVG element", () => {
    const svg = parsed();
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 100");
  });

  it("returns null for markup without an SVG root", () => {
    expect(parseSvgMarkup("<div>no svg here</div>")).toBeNull();
  });
});

describe("sanitizeSvgElement", () => {
  it("removes script nodes and event handlers", () => {
    const svg = parseSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>` +
        `<g onclick="alert(2)"><rect onmouseover="alert(3)"/></g></svg>`,
    )!;

    sanitizeSvgElement(svg);

    expect(svg.querySelector("script")).toBeNull();
    expect(svg.innerHTML).not.toContain("onclick");
    expect(svg.innerHTML).not.toContain("onmouseover");
  });

  it("removes javascript: links but keeps fragment links", () => {
    const svg = parseSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg">` +
        `<a href="javascript:alert(1)"><text>bad</text></a>` +
        `<a href="#node-1"><text>good</text></a></svg>`,
    )!;

    sanitizeSvgElement(svg);

    const anchors = Array.from(svg.querySelectorAll("a"));
    expect(anchors[0]!.hasAttribute("href")).toBe(false);
    expect(anchors[1]!.getAttribute("href")).toBe("#node-1");
  });

  it("keeps the palette stylesheet and safe style attributes", () => {
    const svg = parsed();
    sanitizeSvgElement(svg);

    const style = svg.querySelector("style");
    expect(style?.textContent).toContain("fill: #152d48");
    expect(svg.getAttribute("style")).toContain("max-width");
  });

  it("drops foreignObject and @import", () => {
    const svg = parseSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg">` +
        `<style>@import url("https://example.com/x.css");</style>` +
        `<foreignObject><div>html</div></foreignObject>` +
        `<text>Текст</text></svg>`,
    )!;

    sanitizeSvgElement(svg);

    expect(svg.querySelector("foreignObject")).toBeNull();
    expect(svg.querySelector("style")).toBeNull();
    expect(svg.querySelector("text")?.textContent).toBe("Текст");
  });
});

describe("prefixSvgIds", () => {
  it("prefixes every id and rewrites every local reference", () => {
    const svg = parsed();
    const map = prefixSvgIds(svg, "dv1");

    expect(map.size).toBeGreaterThanOrEqual(4);
    expect(svg.getAttribute("id")).toBe("dv1-mermaid-1");

    const ids = Array.from(svg.querySelectorAll("[id]")).map((element) => element.getAttribute("id"));
    expect(ids).toContain("dv1-arrow");
    expect(ids).toContain("dv1-clip");
    expect(ids).toContain("dv1-label-1");
    expect(ids.every((id) => id?.startsWith("dv1-"))).toBe(true);

    for (const element of Array.from(svg.querySelectorAll("rect, path"))) {
      const marker = element.getAttribute("marker-end");
      if (marker) expect(marker).toBe("url(#dv1-arrow)");
      const clip = element.getAttribute("clip-path");
      if (clip) expect(clip).toBe("url(#dv1-clip)");
    }

    expect(svg.querySelector("a")?.getAttribute("href")).toBe("#dv1-label-1");
    expect(svg.querySelector("#dv1-label-1")?.getAttribute("aria-labelledby")).toBe("dv1-label-1");
  });

  it("rewrites the id selectors inside Mermaid's <style> block", () => {
    const svg = parsed();
    prefixSvgIds(svg, "dv2");

    expect(svg.querySelector("style")?.textContent).toContain("#dv2-mermaid-1 .node rect");
  });

  it("gives two instances of the same diagram disjoint ids", () => {
    const first = parsed();
    const second = parsed();
    prefixSvgIds(first, "dv3");
    prefixSvgIds(second, "dv4");

    const firstIds = new Set(
      Array.from(first.querySelectorAll("[id]")).map((element) => element.getAttribute("id")),
    );
    const secondIds = Array.from(second.querySelectorAll("[id]")).map((element) =>
      element.getAttribute("id"),
    );

    expect(secondIds).not.toHaveLength(0);
    for (const id of secondIds) {
      expect(firstIds.has(id), `id ${id} exists in both diagrams`).toBe(false);
    }
  });

  it("keeps repeated Mermaid ids unique while references stay on the first", () => {
    // Mermaid's mindmap reuses `node_1` on a <g> and a <path>.
    const svg = parseSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
        `<g id="node_1" marker-end="url(#node_1)"><path id="node_1"/></g></svg>`,
    )!;

    prefixSvgIds(svg, "dv8");

    const ids = Array.from(svg.querySelectorAll("[id]")).map((element) => element.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["dv8-node_1", "dv8-node_1-2"]);
    // The reference still resolves to the element that owned the id first.
    expect(svg.querySelector("g")?.getAttribute("marker-end")).toBe("url(#dv8-node_1)");
    expect(svg.querySelector("#dv8-node_1")?.tagName.toLowerCase()).toBe("g");
  });

  it("does nothing when the SVG has no ids", () => {
    const svg = parseSvgMarkup(`<svg xmlns="http://www.w3.org/2000/svg"><text>нет id</text></svg>`)!;
    expect(prefixSvgIds(svg, "dv5").size).toBe(0);
  });
});

describe("svgNaturalSize", () => {
  it("prefers the viewBox", () => {
    expect(svgNaturalSize(parsed())).toEqual({ width: 200, height: 100 });
  });

  it("falls back to width/height attributes", () => {
    const svg = parseSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><text>x</text></svg>`,
    )!;
    expect(svgNaturalSize(svg)).toEqual({ width: 320, height: 180 });
  });
});

describe("toStandaloneSvg", () => {
  it("exports the natural size without the user's zoom", () => {
    const svg = parsed();
    prefixSvgIds(svg, "dv6");
    // What zooming does to the live SVG:
    svg.setAttribute("width", "400");
    svg.setAttribute("height", "200");
    svg.style.width = "400px";
    svg.style.maxWidth = "none";

    const standalone = toStandaloneSvg(svg, { width: 200, height: 100 });

    expect(standalone.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(standalone).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(standalone).toMatch(/width="200"/);
    expect(standalone).toMatch(/height="100"/);
    expect(standalone).toContain('viewBox="0 0 200 100"');
    expect(standalone).not.toContain("400px");
    expect(standalone).not.toContain("transform");
  });

  it("keeps the palette, the marker defs and Cyrillic labels", () => {
    const svg = parsed();
    prefixSvgIds(svg, "dv7");
    const standalone = toStandaloneSvg(svg, { width: 200, height: 100 });

    expect(standalone).toContain("fill: #152d48");
    expect(standalone).toContain("<marker");
    expect(standalone).toContain("Модель документа");
  });
});
