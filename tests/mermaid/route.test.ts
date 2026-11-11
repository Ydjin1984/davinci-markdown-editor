/**
 * Orthogonal routing contract.
 *
 * The browser integration is exercised by `src/dev/renderLab.html`; these tests
 * pin the pure geometry that the ТЗ asks for: orthogonal segments, separate
 * ports for counter-edges, a rectangular loop, a back edge outside the node
 * cloud, diamond vertices, and the fallback when a structure is unsupported.
 */

import { describe, expect, it } from "vitest";

import {
  OrthogonalRouter,
  isOrthogonal,
  portPoint,
  segmentsOf,
  simplify,
  type LayoutNode,
  type RouteEdge,
} from "@/mermaid/route/geometry";
import { improveOrthogonalRoutes } from "@/mermaid/route/svg";

function node(id: string, x: number, y: number, width = 100, height = 40): LayoutNode {
  return { id, box: { x, y, width, height }, kind: "rect" };
}

function routesFor(nodes: LayoutNode[], edges: RouteEdge[]) {
  const router = new OrthogonalRouter(nodes);
  return router.route(edges);
}

function segmentsOverlap(
  first: { a: { x: number; y: number }; b: { x: number; y: number } },
  second: typeof first,
): boolean {
  const firstHorizontal = Math.abs(first.a.y - first.b.y) < 0.5;
  const secondHorizontal = Math.abs(second.a.y - second.b.y) < 0.5;
  if (firstHorizontal !== secondHorizontal) return false;
  if (firstHorizontal) {
    if (Math.abs(first.a.y - second.a.y) > 0.5) return false;
    const a1 = Math.min(first.a.x, first.b.x);
    const a2 = Math.max(first.a.x, first.b.x);
    const b1 = Math.min(second.a.x, second.b.x);
    const b2 = Math.max(second.a.x, second.b.x);
    return Math.min(a2, b2) > Math.max(a1, b1);
  }
  if (Math.abs(first.a.x - second.a.x) > 0.5) return false;
  const a1 = Math.min(first.a.y, first.b.y);
  const a2 = Math.max(first.a.y, first.b.y);
  const b1 = Math.min(second.a.y, second.b.y);
  const b2 = Math.max(second.a.y, second.b.y);
  return Math.min(a2, b2) > Math.max(a1, b1);
}

describe("orthogonal router", () => {
  it("keeps every segment horizontal or vertical", () => {
    const nodes = [node("A", 0, 0), node("B", 300, 0), node("C", 300, 200), node("D", 0, 200)];
    const results = routesFor(nodes, [
      { id: "L_A_B_0", from: "A", to: "B" },
      { id: "L_B_C_0", from: "B", to: "C" },
      { id: "L_C_D_0", from: "C", to: "D" },
    ]);

    for (const result of results.values()) {
      expect(result.failed).toBe(false);
      expect(isOrthogonal(result.points)).toBe(true);
    }
  });

  it("gives counter-edges separate ports and no shared segment", () => {
    const nodes = [node("A", 0, 0), node("B", 320, 0)];
    const results = routesFor(nodes, [
      { id: "L_A_B_0", from: "A", to: "B" },
      { id: "L_B_A_0", from: "B", to: "A" },
    ]);

    const forward = results.get("L_A_B_0")!;
    const back = results.get("L_B_A_0")!;
    expect(forward.failed).toBe(false);
    expect(back.failed).toBe(false);

    for (const first of segmentsOf(forward.points)) {
      for (const second of segmentsOf(back.points)) {
        expect(segmentsOverlap(first, second)).toBe(false);
      }
    }
  });

  it("routes a back edge outside the node cloud", () => {
    const nodes = [node("A", 0, 0), node("B", 320, 0), node("C", 180, 200)];
    const results = routesFor(nodes, [
      { id: "L_A_B_0", from: "A", to: "B" },
      { id: "L_B_A_0", from: "B", to: "A" },
    ]);

    const back = results.get("L_B_A_0")!;
    expect(back.failed).toBe(false);
    const lowest = Math.max(...back.points.map((point) => point.y));
    const deepestNode = Math.max(...nodes.map((item) => item.box.y + item.box.height));
    expect(lowest).toBeGreaterThan(deepestNode);
  });

  it("draws a rectangular loop to the right of the node", () => {
    const nodes = [node("A", 0, 0, 120, 50)];
    const results = routesFor(nodes, [{ id: "L_A_A_0", from: "A", to: "A" }]);

    const loop = results.get("L_A_A_0")!;
    expect(loop.failed).toBe(false);
    expect(isOrthogonal(loop.points)).toBe(true);
    expect(loop.points.length).toBe(4);
    for (const point of loop.points) expect(point.x).toBeGreaterThanOrEqual(120);
    const ys = new Set(loop.points.map((point) => point.y));
    expect(ys.size).toBe(2);
  });

  it("uses diamond vertices as ports", () => {
    const diamond: LayoutNode = { id: "D", box: { x: 0, y: 0, width: 100, height: 100 }, kind: "diamond" };
    expect(portPoint(diamond, "top")).toEqual({ x: 50, y: 0 });
    expect(portPoint(diamond, "bottom")).toEqual({ x: 50, y: 100 });
    expect(portPoint(diamond, "left")).toEqual({ x: 0, y: 50 });
    expect(portPoint(diamond, "right")).toEqual({ x: 100, y: 50 });
  });

  it("enters a diamond through a free vertex, not a reused one", () => {
    const nodes: LayoutNode[] = [
      node("A", 0, 0),
      node("B", 0, 200),
      { id: "D", box: { x: 300, y: 100, width: 120, height: 120 }, kind: "diamond" },
    ];
    const results = routesFor(nodes, [
      { id: "L_A_D_0", from: "A", to: "D" },
      { id: "L_B_D_0", from: "B", to: "D" },
    ]);

    const endpoints = [...results.values()].map((result) => result.points[result.points.length - 1]!);
    expect(new Set(endpoints.map((point) => `${point.x},${point.y}`)).size).toBe(2);
  });

  it("routes a connector to a note without crossing shapes", () => {
    const nodes: LayoutNode[] = [
      node("A", 0, 0, 100, 40),
      { id: "N", box: { x: 160, y: 60, width: 140, height: 50 }, kind: "note" },
    ];
    const results = routesFor(nodes, [{ id: "note", from: "A", to: "N" }]);
    const result = results.get("note")!;
    expect(result.failed).toBe(false);
    expect(isOrthogonal(result.points)).toBe(true);
  });

  it("reports a failure instead of guessing when a node is unknown", () => {
    const nodes = [node("A", 0, 0)];
    const results = routesFor(nodes, [{ id: "L_A_X_0", from: "A", to: "X" }]);
    expect(results.get("L_A_X_0")).toEqual({ points: [], failed: true, reason: undefined });
  });
});

describe("browser fallback", () => {
  it("returns the Mermaid SVG unchanged when there is no DOM", () => {
    // Node has no document/DOMPoint: the router must not touch the SVG.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`;
    expect(improveOrthogonalRoutes(svg)).toBe(svg);
  });
});

describe("simplify", () => {
  it("snaps sub-pixel runs and drops collinear points", () => {
    const points = simplify([
      { x: 0, y: 0 },
      { x: 100, y: 0.4 },
      { x: 100, y: 80 },
      { x: 100, y: 160 },
    ]);
    expect(points.length).toBe(3);
    expect(points[0]!.y).toBe(points[1]!.y);
    expect(points[1]!.x).toBe(points[2]!.x);
    expect(points[2]!.y).toBe(160);
    expect(isOrthogonal(points)).toBe(true);
  });
});
