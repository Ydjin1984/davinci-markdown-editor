/**
 * Orthogonal edge routing for Mermaid flowcharts and state diagrams.
 *
 * Mermaid's dagre layout places the nodes correctly for the DaVinci templates
 * but routes edges centre-to-centre: routes run under their own labels,
 * independent edges share segments, and an edge can leave a diamond through a
 * slanted vertex. This module keeps the layout and rebuilds the routes from
 * horizontal and vertical segments only.
 *
 * Everything here is pure: no DOM, no Mermaid. `svg.ts` reads the rendered SVG
 * into these structures, calls `routeAll`, and writes the result back.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type NodeKind = "rect" | "diamond" | "cylinder" | "circle" | "note" | "other";

export type Side = "top" | "right" | "bottom" | "left";

export interface LayoutNode {
  id: string;
  box: Box;
  kind: NodeKind;
}

export interface RouteEdge {
  id: string;
  from: string;
  to: string;
}

export interface RouteOptions {
  /** Clearance between a route and any foreign shape or line. */
  gap: number;
  /** Distance between two ports that share one side of a node. */
  portGap: number;
  /** Corridor distance outside the node cloud for back edges. */
  outer: number;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  gap: 12,
  portGap: 22,
  outer: 16,
};

const EPSILON = 0.5;

export function centerOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function rightEdge(box: Box): number {
  return box.x + box.width;
}

export function bottomEdge(box: Box): number {
  return box.y + box.height;
}

export function pointInBox(point: Point, box: Box, tolerance = 0): boolean {
  return (
    point.x >= box.x - tolerance &&
    point.x <= rightEdge(box) + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= bottomEdge(box) + tolerance
  );
}

/** Distance from a point to a box; zero when the point is inside. */
export function distanceToBox(point: Point, box: Box): number {
  const dx = Math.max(box.x - point.x, 0, point.x - rightEdge(box));
  const dy = Math.max(box.y - point.y, 0, point.y - bottomEdge(box));
  return Math.hypot(dx, dy);
}

/** A point on the border of a node, `offset` pixels along that side. */
export function portPoint(node: LayoutNode, side: Side, offset = 0): Point {
  const { box } = node;
  if (node.kind === "diamond") {
    // A diamond only meets its border at the four vertices.
    switch (side) {
      case "top":
        return { x: box.x + box.width / 2, y: box.y };
      case "bottom":
        return { x: box.x + box.width / 2, y: bottomEdge(box) };
      case "left":
        return { x: box.x, y: box.y + box.height / 2 };
      case "right":
      default:
        return { x: rightEdge(box), y: box.y + box.height / 2 };
    }
  }

  const horizontal = side === "top" || side === "bottom";
  const limit = Math.max(0, (horizontal ? box.width : box.height) / 2 - 10);
  const clamped = Math.max(-limit, Math.min(limit, offset));

  switch (side) {
    case "top":
      return { x: box.x + box.width / 2 + clamped, y: box.y };
    case "bottom":
      return { x: box.x + box.width / 2 + clamped, y: bottomEdge(box) };
    case "left":
      return { x: box.x, y: box.y + box.height / 2 + clamped };
    case "right":
    default:
      return { x: rightEdge(box), y: box.y + box.height / 2 + clamped };
  }
}

export function oppositeSide(side: Side): Side {
  switch (side) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
    default:
      return "left";
  }
}

export function isHorizontalSide(side: Side): boolean {
  return side === "left" || side === "right";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Collapse duplicated and collinear points so the path has no dead segments. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) {
      continue;
    }
    out.push({ x: round(point.x), y: round(point.y) });
  }

  // Two ports can differ by a fraction of a pixel (a diamond's vertex and a
  // rectangle's centre); snap those runs so the path stays strictly M/H/V.
  for (let index = 1; index < out.length; index += 1) {
    const a = out[index - 1]!;
    const b = out[index]!;
    if (Math.abs(a.y - b.y) < EPSILON) {
      const y = round((a.y + b.y) / 2);
      a.y = y;
      b.y = y;
    } else if (Math.abs(a.x - b.x) < EPSILON) {
      const x = round((a.x + b.x) / 2);
      a.x = x;
      b.x = x;
    }
  }

  for (let index = 1; index < out.length - 1;) {
    const a = out[index - 1]!;
    const b = out[index]!;
    const c = out[index + 1]!;
    const collinear =
      (Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - c.x) < EPSILON) ||
      (Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - c.y) < EPSILON);
    if (collinear) out.splice(index, 1);
    else index += 1;
  }

  return out;
}

export interface Segment {
  a: Point;
  b: Point;
}

export function segmentsOf(points: Point[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push({ a: points[index - 1]!, b: points[index]! });
  }
  return segments;
}

export function isOrthogonal(points: Point[]): boolean {
  return segmentsOf(points).every(
    ({ a, b }) => Math.abs(a.x - b.x) < EPSILON || Math.abs(a.y - b.y) < EPSILON,
  );
}

function segmentTouchesBox(segment: Segment, box: Box, inset: number): boolean {
  const minX = box.x + inset;
  const maxX = rightEdge(box) - inset;
  const minY = box.y + inset;
  const maxY = bottomEdge(box) - inset;
  if (minX >= maxX || minY >= maxY) return false;

  if (Math.abs(segment.a.y - segment.b.y) < EPSILON) {
    const y = segment.a.y;
    if (y <= minY || y >= maxY) return false;
    const from = Math.min(segment.a.x, segment.b.x);
    const to = Math.max(segment.a.x, segment.b.x);
    return to > minX && from < maxX;
  }

  if (Math.abs(segment.a.x - segment.b.x) < EPSILON) {
    const x = segment.a.x;
    if (x <= minX || x >= maxX) return false;
    const from = Math.min(segment.a.y, segment.b.y);
    const to = Math.max(segment.a.y, segment.b.y);
    return to > minY && from < maxY;
  }

  // A slanted segment never comes from this router; treat it as a collider.
  return true;
}

function overlapsCollinearly(first: Segment, second: Segment, tolerance: number): boolean {
  const firstHorizontal = Math.abs(first.a.y - first.b.y) < EPSILON;
  const secondHorizontal = Math.abs(second.a.y - second.b.y) < EPSILON;
  if (firstHorizontal !== secondHorizontal) return false;

  if (firstHorizontal) {
    if (Math.abs(first.a.y - second.a.y) >= tolerance) return false;
    const a1 = Math.min(first.a.x, first.b.x);
    const a2 = Math.max(first.a.x, first.b.x);
    const b1 = Math.min(second.a.x, second.b.x);
    const b2 = Math.max(second.a.x, second.b.x);
    return Math.min(a2, b2) - Math.max(a1, b1) > EPSILON;
  }

  if (Math.abs(first.a.x - second.a.x) >= tolerance) return false;
  const a1 = Math.min(first.a.y, first.b.y);
  const a2 = Math.max(first.a.y, first.b.y);
  const b1 = Math.min(second.a.y, second.b.y);
  const b2 = Math.max(second.a.y, second.b.y);
  return Math.min(a2, b2) - Math.max(a1, b1) > EPSILON;
}

function crosses(first: Segment, second: Segment): boolean {
  const firstHorizontal = Math.abs(first.a.y - first.b.y) < EPSILON;
  const secondHorizontal = Math.abs(second.a.y - second.b.y) < EPSILON;
  if (firstHorizontal === secondHorizontal) return false;

  const horizontal = firstHorizontal ? first : second;
  const vertical = firstHorizontal ? second : first;
  const hx1 = Math.min(horizontal.a.x, horizontal.b.x);
  const hx2 = Math.max(horizontal.a.x, horizontal.b.x);
  const vy1 = Math.min(vertical.a.y, vertical.b.y);
  const vy2 = Math.max(vertical.a.y, vertical.b.y);
  return (
    vertical.a.x > hx1 + EPSILON &&
    vertical.a.x < hx2 - EPSILON &&
    horizontal.a.y > vy1 + EPSILON &&
    horizontal.a.y < vy2 - EPSILON
  );
}

export interface RouteResult {
  points: Point[];
  /** True when the original Mermaid path must be kept instead. */
  failed: boolean;
  /** Why routing failed; development aid, never shown to the user. */
  reason?: string;
}

export type PrimaryAxis = "horizontal" | "vertical";

export interface RoutedEdge extends RouteEdge {
  result: RouteResult;
}

/**
 * Rebuild orthogonal routes for every edge whose endpoints are known.
 *
 * Deterministic: edges are processed in a stable order (forward, dotted, back,
 * self), each takes the preferred pair of sides, and a conflicting corridor is
 * shifted by fixed steps until free. A route that still collides reports
 * `failed`, and the caller keeps Mermaid's own path for that edge.
 */
export class OrthogonalRouter {
  private readonly nodes: Map<string, LayoutNode>;
  private readonly options: RouteOptions;
  private readonly sideCounts = new Map<string, number>();
  private readonly usedSides = new Map<string, Set<Side>>();
  private readonly takenSegments: Segment[] = [];
  private axis: PrimaryAxis = "horizontal";

  constructor(nodes: Iterable<LayoutNode>, options: RouteOptions = DEFAULT_ROUTE_OPTIONS) {
    this.nodes = new Map(Array.from(nodes, (node) => [node.id, node]));
    this.options = options;
  }

  route(edges: RouteEdge[]): Map<string, RouteResult> {
    this.axis = this.computeAxis(edges);
    const results = new Map<string, RouteResult>();
    const ordered = [...edges].sort((a, b) => this.weight(a) - this.weight(b) || a.id.localeCompare(b.id));

    for (const edge of ordered) {
      const result = this.routeOne(edge);
      results.set(edge.id, result);
      if (!result.failed) this.takenSegments.push(...segmentsOf(result.points));
      this.reserveSidesFromResult(edge, result);
    }

    return results;
  }

  private computeAxis(edges: RouteEdge[]): PrimaryAxis {
    let sumX = 0;
    let sumY = 0;
    for (const edge of edges) {
      const from = this.nodes.get(edge.from);
      const to = this.nodes.get(edge.to);
      if (!from || !to || edge.from === edge.to) continue;
      const source = centerOf(from.box);
      const target = centerOf(to.box);
      sumX += Math.abs(target.x - source.x);
      sumY += Math.abs(target.y - source.y);
    }
    return sumX >= sumY ? "horizontal" : "vertical";
  }

  private weight(edge: RouteEdge): number {
    if (edge.from === edge.to) return 0;
    return this.isBackward(edge) ? 2 : 1;
  }

  private isBackward(edge: RouteEdge): boolean {
    const from = this.nodes.get(edge.from);
    const to = this.nodes.get(edge.to);
    if (!from || !to || edge.from === edge.to) return false;
    const source = centerOf(from.box);
    const target = centerOf(to.box);
    return this.axis === "horizontal" ? target.x < source.x - 1 : target.y < source.y - 1;
  }

  private routeOne(edge: RouteEdge): RouteResult {
    const from = this.nodes.get(edge.from);
    const to = this.nodes.get(edge.to);
    if (!from || !to) return { points: [], failed: true };
    if (edge.from === edge.to) return this.routeLoop(from);

    const source = centerOf(from.box);
    const target = centerOf(to.box);
    const backward = this.isBackward(edge);
    const out = this.chooseSide(from, source, target, backward, "out");
    const into = this.chooseSide(to, target, source, backward, "in");

    // A straight run needs no port offset: shifting one endpoint would turn a
    // single segment into a step for no reason.
    const straightHorizontal =
      isHorizontalSide(out) && isHorizontalSide(into) && Math.abs(source.y - target.y) < this.options.gap;
    const straightVertical =
      !isHorizontalSide(out) && !isHorizontalSide(into) && Math.abs(source.x - target.x) < this.options.gap;
    const straight = straightHorizontal || straightVertical;

    const outDirection = this.portDirection(from, to, out);
    const inDirection = this.portDirection(from, to, into);
    const startPoint = portPoint(from, out, straight ? 0 : this.nextOffset(from, out, outDirection));
    const endPoint = portPoint(to, into, straight ? 0 : this.nextOffset(to, into, inDirection));

    // Ports on two nearly aligned sides are snapped to one axis; otherwise the
    // path would get a sub-pixel diagonal that no renderer can draw cleanly.
    if (!isHorizontalSide(out) && !isHorizontalSide(into)) {
      if (Math.abs(startPoint.x - endPoint.x) < this.options.portGap) {
        startPoint.x = endPoint.x;
      }
    } else if (isHorizontalSide(out) && isHorizontalSide(into)) {
      if (Math.abs(startPoint.y - endPoint.y) < this.options.portGap) {
        startPoint.y = endPoint.y;
      }
    }

    const candidates = this.buildCandidates(from, to, out, into, startPoint, endPoint, backward);
    let reason = "no-candidate";
    for (const candidate of candidates) {
      const points = simplify(candidate);
      if (!isOrthogonal(points)) {
        reason = "slant";
        continue;
      }
      const problem = this.collides(points);
      if (!problem) return { points, failed: false };
      reason = problem;
    }

    return { points: simplify(candidates[0] ?? [startPoint, endPoint]), failed: true, reason };
  }

  private routeLoop(node: LayoutNode): RouteResult {
    const { box } = node;
    const middle = box.y + box.height / 2;
    const outerX = rightEdge(box) + this.options.gap + this.options.outer;
    const points = simplify([
      { x: rightEdge(box), y: middle - 10 },
      { x: outerX, y: middle - 10 },
      { x: outerX, y: middle + 10 },
      { x: rightEdge(box), y: middle + 10 },
    ]);
    let used = this.usedSides.get(node.id);
    if (!used) {
      used = new Set<Side>();
      this.usedSides.set(node.id, used);
    }
    used.add("right");
    return { points, failed: false };
  }

  private chooseSide(
    node: LayoutNode,
    self: Point,
    toward: Point,
    backward: boolean,
    role: "in" | "out",
  ): Side {
    if (backward) {
      if (this.axis === "horizontal") {
        return this.resolveDiamond(node, "bottom", toward);
      }
      // Vertical graphs route the return edge around the flow on the side the
      // edge is heading to, so it never slices through the forward edges.
      const side: Side =
        role === "out" ? (toward.x > self.x ? "left" : "right") : toward.x < self.x ? "left" : "right";
      return this.resolveDiamond(node, side, toward);
    }

    const dx = toward.x - self.x;
    const dy = toward.y - self.y;
    let side: Side;

    if (this.axis === "horizontal") {
      // A visibly vertical hop leaves through the top and enters through the
      // top of a target that sits below: that is what the reference layout does
      // for "Middleware → Кэш" and "Кэш → Profitbase".
      const vertical = Math.abs(dy) >= Math.abs(dx) * 0.25;
      if (role === "out") {
        if (dy < 0 && vertical) side = "top";
        else if (Math.abs(dx) < this.options.gap) side = dy >= 0 ? "bottom" : "top";
        else side = dx >= 0 ? "right" : "left";
      } else {
        if (dy < 0 && vertical) side = "top";
        else if (Math.abs(dx) < this.options.gap) side = dy >= 0 ? "bottom" : "top";
        else side = dx >= 0 ? "right" : "left";
      }
    } else {
      // Vertical graphs (state diagrams) follow the flow, not the raw delta.
      const horizontalBias = Math.abs(dx) >= Math.abs(dy) * 1.6;
      if (horizontalBias) {
        side = role === "out" ? (dx >= 0 ? "right" : "left") : dx >= 0 ? "right" : "left";
      } else if (role === "out") {
        side = dy >= 0 ? "bottom" : "top";
      } else {
        side = dy >= 0 ? "bottom" : "top";
      }
    }

    // A side that already carries a port is a last resort for an incoming edge.
    if (role === "in" && node.kind !== "diamond" && this.sideIsUsed(node, side)) {
      const alternative = this.freeSide(node, toward, side);
      if (alternative) side = alternative;
    }

    return this.resolveDiamond(node, side, toward);
  }

  private sideIsUsed(node: LayoutNode, side: Side): boolean {
    return this.usedSides.get(node.id)?.has(side) ?? false;
  }

  private freeSide(node: LayoutNode, toward: Point, avoid: Side): Side | null {
    const candidates = (["left", "right", "top", "bottom"] as Side[]).filter(
      (side) => side !== avoid && !this.sideIsUsed(node, side),
    );
    if (candidates.length === 0) return null;
    const score = (side: Side) => {
      const point = portPoint(node, side);
      return Math.abs(point.x - toward.x) + Math.abs(point.y - toward.y);
    };
    return candidates.sort((a, b) => score(a) - score(b))[0] ?? null;
  }

  /** A diamond has only four usable vertices: never reuse one for two edges. */
  private resolveDiamond(node: LayoutNode, preferred: Side, toward: Point): Side {
    if (node.kind !== "diamond") return preferred;
    const used = this.usedSides.get(node.id) ?? new Set<Side>();
    if (!used.has(preferred)) return preferred;
    const free = (["top", "left", "right", "bottom"] as Side[])
      .filter((side) => !used.has(side))
      .sort(
        (a, b) =>
          Math.abs(portPoint(node, a).x - toward.x) +
          Math.abs(portPoint(node, a).y - toward.y) -
          (Math.abs(portPoint(node, b).x - toward.x) + Math.abs(portPoint(node, b).y - toward.y)),
      );
    return free[0] ?? preferred;
  }

  private portDirection(from: LayoutNode, to: LayoutNode, side: Side): number {
    const delta = isHorizontalSide(side)
      ? centerOf(to.box).y - centerOf(from.box).y
      : centerOf(to.box).x - centerOf(from.box).x;
    if (Math.abs(delta) < 1) return 0;
    return delta > 0 ? 1 : -1;
  }

  private nextOffset(node: LayoutNode, side: Side, direction: number): number {
    const key = `${node.id}:${side}:${direction}`;
    const count = this.sideCounts.get(key) ?? 0;
    this.sideCounts.set(key, count + 1);
    let used = this.usedSides.get(node.id);
    if (!used) {
      used = new Set<Side>();
      this.usedSides.set(node.id, used);
    }
    used.add(side);
    if (direction === 0) return 0;
    // Every port is displaced in the direction the edge is heading, so two
    // edges that leave the same side towards different halves of the graph
    // never share a line and never cross on the way out.
    return direction * this.options.portGap * (count + 1);
  }

  private reserveSidesFromResult(edge: RouteEdge, result: RouteResult): void {
    if (result.failed || result.points.length < 2) return;
    const first = result.points[0]!;
    const second = result.points[1]!;
    const from = this.nodes.get(edge.from);
    if (from) this.reserveSideAt(from, first, second);
    const last = result.points[result.points.length - 1]!;
    const previous = result.points[result.points.length - 2]!;
    const to = this.nodes.get(edge.to);
    if (to) this.reserveSideAt(to, last, previous);
  }

  private reserveSideAt(node: LayoutNode, border: Point, inward: Point): void {
    let side: Side;
    if (Math.abs(inward.x - border.x) > Math.abs(inward.y - border.y)) {
      side = inward.x > border.x ? "right" : "left";
    } else {
      side = inward.y > border.y ? "bottom" : "top";
    }
    let used = this.usedSides.get(node.id);
    if (!used) {
      used = new Set<Side>();
      this.usedSides.set(node.id, used);
    }
    used.add(side);
  }

  private buildCandidates(
    from: LayoutNode,
    to: LayoutNode,
    out: Side,
    into: Side,
    start: Point,
    end: Point,
    backward: boolean,
  ): Point[][] {
    const gap = this.options.gap;
    const candidates: Point[][] = [];
    void from;
    void to;

    if (backward) {
      if (this.axis === "horizontal") {
        for (const corridor of this.backCorridors()) {
          candidates.push([start, { x: start.x, y: corridor }, { x: end.x, y: corridor }, end]);
        }
      } else {
        for (const corridor of this.backCorridors()) {
          candidates.push([start, { x: corridor, y: start.y }, { x: corridor, y: end.y }, end]);
        }
      }
      return candidates;
    }

    const alignedX = Math.abs(start.x - end.x) < gap;
    const alignedY = Math.abs(start.y - end.y) < gap;

    if (alignedX && !isHorizontalSide(out) && !isHorizontalSide(into)) {
      candidates.push([start, end]);
      return candidates;
    }
    if (alignedY && isHorizontalSide(out) && isHorizontalSide(into)) {
      candidates.push([start, end]);
      return candidates;
    }

    if (isHorizontalSide(out) && isHorizontalSide(into)) {
      const midX = this.midCoordinate(start.x, end.x, gap);
      candidates.push([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
      candidates.push([start, { x: end.x, y: start.y }, end]);
      candidates.push([start, { x: start.x, y: end.y }, end]);
      return candidates;
    }

    if (!isHorizontalSide(out) && !isHorizontalSide(into)) {
      const midY = this.midCoordinate(start.y, end.y, gap);
      candidates.push([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
      candidates.push([start, { x: start.x, y: end.y }, end]);
      candidates.push([start, { x: end.x, y: start.y }, end]);
      return candidates;
    }

    const corner = isHorizontalSide(out) ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    candidates.push([start, corner, end]);
    return candidates;
  }

  private midCoordinate(from: number, to: number, gap: number): number {
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    if (max - min >= gap * 2) return from < to ? max - gap * 2 : min + gap * 2;
    return (from + to) / 2;
  }

  private backCorridors(): number[] {
    const step = this.options.gap + this.options.outer;
    if (this.axis === "horizontal") {
      let lowest = -Infinity;
      for (const node of this.nodes.values()) lowest = Math.max(lowest, bottomEdge(node.box));
      return [lowest + step, lowest + step * 2, lowest + step * 3];
    }
    let rightmost = -Infinity;
    let leftmost = Infinity;
    for (const node of this.nodes.values()) {
      rightmost = Math.max(rightmost, rightEdge(node.box));
      leftmost = Math.min(leftmost, node.box.x);
    }
    return [leftmost - step, rightmost + step, rightmost + step * 2];
  }

  private collides(points: Point[]): string | null {
    const segments = segmentsOf(points);
    if (segments.length === 0) return "empty";
    const inset = 3;
    // Shorten both ends so that a segment leaving a node's border perpendicular
    // to it is not mistaken for a segment that cuts through the node.
    const shortened = segments.map((segment) => shorten(segment, 2));

    for (const node of this.nodes.values()) {
      for (const segment of shortened) {
        if (segmentTouchesBox(segment, node.box, inset)) {
          return `node:${node.id}@${Math.round(segment.a.x)},${Math.round(segment.a.y)}-${Math.round(segment.b.x)},${Math.round(segment.b.y)}`;
        }
      }
    }

    for (const segment of segments) {
      for (const taken of this.takenSegments) {
        if (overlapsCollinearly(segment, taken, this.options.gap / 2)) return "overlap";
        if (crosses(segment, taken)) return "cross";
      }
    }

    return null;
  }
}

function shorten(segment: Segment, by: number): Segment {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.abs(dx) + Math.abs(dy);
  if (length <= by * 2) return segment;
  const ux = Math.abs(dx) < EPSILON ? 0 : Math.sign(dx);
  const uy = Math.abs(dy) < EPSILON ? 0 : Math.sign(dy);
  return {
    a: { x: segment.a.x + ux * by, y: segment.a.y + uy * by },
    b: { x: segment.b.x - ux * by, y: segment.b.y - uy * by },
  };
}
