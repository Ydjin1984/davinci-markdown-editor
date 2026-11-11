// @vitest-environment jsdom

/**
 * Clustered flowcharts are left to Mermaid.
 *
 * Regression guard for the 0.4.0 bug: re-routing a `flowchart` with subgraphs
 * moved arrows away from their shapes. Node boxes were measured in SVG user
 * coordinates while a path's `d` is written in its own group's coordinates, so
 * the new points were offset twice. The router now detects clusters before it
 * measures anything and leaves the diagram untouched.
 */

import { describe, expect, it } from "vitest";

import { isClusteredFlowchart } from "@/mermaid/route/svg";

function svg(markup: string): SVGSVGElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const element = holder.querySelector("svg");
  if (!element) throw new Error("test fixture has no <svg>");
  return element;
}

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg"';

describe("isClusteredFlowchart", () => {
  it("detects a cluster wrapper", () => {
    const element = svg(
      `${HEAD} aria-roledescription="flowchart-v2"><g class="subgraphs"><g class="cluster" id="I1"><rect/></g></g></svg>`,
    );
    expect(isClusteredFlowchart(element)).toBe(true);
  });

  it("detects an unlabelled subgraph group", () => {
    const element = svg(
      `${HEAD} aria-roledescription="flowchart-v2"><g class="subgraphs"><g id="S1"><rect/></g></g></svg>`,
    );
    expect(isClusteredFlowchart(element)).toBe(true);
  });

  it("detects clustered ELK output", () => {
    const element = svg(
      `${HEAD} aria-roledescription="flowchart-elk"><g class="cluster" id="C"><rect/></g></svg>`,
    );
    expect(isClusteredFlowchart(element)).toBe(true);
  });

  it("does not treat a flat flowchart as clustered", () => {
    const element = svg(
      `${HEAD} aria-roledescription="flowchart-v2"><g class="nodes"><g class="node" id="A"/></g><g class="edgePaths"><path d="M0,0L10,10"/></g></svg>`,
    );
    expect(isClusteredFlowchart(element)).toBe(false);
  });

  it("leaves state diagrams alone", () => {
    const element = svg(
      `${HEAD} aria-roledescription="stateDiagram"><g class="cluster" id="C"><rect/></g></svg>`,
    );
    expect(isClusteredFlowchart(element)).toBe(false);
  });
});
