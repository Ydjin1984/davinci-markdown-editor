/**
 * DOM side of the orthogonal router.
 *
 * `improveOrthogonalRoutes` takes the SVG string Mermaid produced, reads the
 * node boxes and the edge endpoints from the rendered markup, rebuilds the
 * routes with `OrthogonalRouter`, moves edge labels onto their own long
 * segments, and grows the viewBox so nothing is clipped. When the structure is
 * unknown (another diagram type, a missing endpoint, unreadable geometry) it
 * returns the input unchanged: Mermaid's own SVG is always a valid fallback.
 */

import {
  OrthogonalRouter,
  bottomEdge,
  centerOf,
  distanceToBox,
  isOrthogonal,
  rightEdge,
  segmentsOf,
  type Box,
  type LayoutNode,
  type NodeKind,
  type Point,
  type RouteEdge,
  type RouteResult,
} from "./geometry";

const LABEL_GAP = 10;
const VIEW_PADDING = 16;
const MARKER_CLEARANCE = 4;

interface CollectedNode extends LayoutNode {
  el: SVGGElement;
}

interface CollectedEdge extends RouteEdge {
  el: SVGPathElement;
  /** Endpoints of Mermaid's own path, used only to identify the nodes. */
  endpoints: [Point, Point];
  noteEdge: boolean;
}

interface LabelBox {
  el: SVGGElement;
  box: Box;
}

/** Read a group's box in SVG user coordinates (all transforms applied). */
function userBox(el: SVGGraphicsElement): Box {
  const bbox = el.getBBox();
  const matrix = el.getCTM();
  if (!matrix) return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  const first = new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix);
  const second = new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix);
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

function nodeKind(group: SVGGElement, shape: SVGGraphicsElement): NodeKind {
  const classes = `${group.getAttribute("class") ?? ""} ${shape.getAttribute("class") ?? ""}`;
  if (classes.includes("statediagram-note")) return "note";
  const tag = shape.tagName.toLowerCase();
  if (tag === "polygon") return "diamond";
  if (tag === "circle") return "circle";
  if (tag === "path") {
    const d = shape.getAttribute("d") ?? "";
    // A cylinder is drawn as a path with elliptical arcs at both caps.
    if (/[aA]/.test(d)) return "cylinder";
  }
  return "rect";
}

function flowchartNodeName(id: string): string | null {
  const match = /-flowchart-(.+?)-\d+$/.exec(id);
  return match ? match[1]! : null;
}

function collectNodes(svg: SVGSVGElement): Map<string, CollectedNode> {
  const nodes = new Map<string, CollectedNode>();
  for (const group of svg.querySelectorAll<SVGGElement>("g.node")) {
    const shape = group.querySelector<SVGGraphicsElement>("rect, path, circle, polygon, ellipse");
    if (!shape) continue;
    const name = flowchartNodeName(group.id) ?? group.id;
    if (!name) continue;
    nodes.set(name, {
      id: name,
      box: userBox(shape),
      kind: nodeKind(group, shape),
      el: group,
    });
  }
  return nodes;
}

function decodePoints(value: string | null): Point[] {
  if (!value) return [];
  try {
    const json = atob(value);
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Point =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Point).x === "number" &&
        typeof (item as Point).y === "number",
    );
  } catch {
    return [];
  }
}

function parsePathEndpoints(d: string): [Point, Point] | null {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 4) return null;
  const values = numbers.map(Number);
  return [
    { x: values[0]!, y: values[1]! },
    { x: values[values.length - 2]!, y: values[values.length - 1]! },
  ];
}

function nearestNode(nodes: Map<string, CollectedNode>, point: Point, tolerance = 10): CollectedNode | null {
  let best: CollectedNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes.values()) {
    const distance = distanceToBox(point, node.box);
    if (distance <= tolerance && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function edgeFromDataId(dataId: string, nodes: Map<string, CollectedNode>): [string, string] | null {
  if (!dataId.startsWith("L_")) return null;
  for (const from of nodes.keys()) {
    const prefix = `L_${from}_`;
    if (!dataId.startsWith(prefix)) continue;
    const rest = dataId.slice(prefix.length);
    const match = /^(.+)_\d+$/.exec(rest);
    if (!match) continue;
    const to = match[1]!;
    if (nodes.has(to)) return [from, to];
  }
  return null;
}

function collectEdges(svg: SVGSVGElement, nodes: Map<string, CollectedNode>): CollectedEdge[] {
  const edges: CollectedEdge[] = [];
  const seen = new Set<SVGPathElement>();

  for (const path of svg.querySelectorAll<SVGPathElement>("g.edgePaths > path, g.edgePath > path")) {
    if (seen.has(path)) continue;
    seen.add(path);
    const dataId = path.dataset.id ?? path.getAttribute("data-id") ?? path.id;
    const endpoints = decodePoints(path.getAttribute("data-points"));
    const fallback = parsePathEndpoints(path.getAttribute("d") ?? "");
    const pair = endpoints.length >= 2 ? [endpoints[0]!, endpoints[endpoints.length - 1]!] : fallback;
    if (!pair) continue;

    let from: string | undefined;
    let to: string | undefined;
    const named = edgeFromDataId(dataId, nodes);
    if (named) {
      [from, to] = named;
    } else {
      from = nearestNode(nodes, pair[0])?.id;
      to = nearestNode(nodes, pair[1])?.id;
    }
    if (!from || !to) continue;

    const classes = `${path.getAttribute("class") ?? ""}`;
    edges.push({
      id: dataId,
      from,
      to,
      el: path,
      endpoints: [pair[0], pair[1]],
      noteEdge: classes.includes("note-edge") || dataId.includes("--note"),
    });
  }

  return edges;
}

function toPathData(points: Point[]): string {
  if (points.length < 2) return "";
  const format = (value: number) => String(Math.round(value * 100) / 100);
  let d = `M${format(points[0]!.x)},${format(points[0]!.y)}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = points[index - 1]!;
    if (Math.abs(point.x - previous.x) < 0.01) d += `V${format(point.y)}`;
    else if (Math.abs(point.y - previous.y) < 0.01) d += `H${format(point.x)}`;
    else d += `L${format(point.x)},${format(point.y)}`;
  }
  return d;
}

function edgeKeyFromLabel(label: SVGGElement): string | null {
  const inner = label.querySelector<SVGGElement>("[data-id]");
  const dataId = inner?.getAttribute("data-id");
  if (dataId) return dataId;
  return label.getAttribute("data-id");
}

function labelIntersects(
  box: Box,
  routes: Map<string, RouteResult>,
  ownId: string,
  nodes: Map<string, CollectedNode>,
): boolean {
  for (const [id, result] of routes) {
    if (id === ownId || result.failed) continue;
    for (const segment of segmentsOf(result.points)) {
      const minX = Math.min(segment.a.x, segment.b.x);
      const maxX = Math.max(segment.a.x, segment.b.x);
      const minY = Math.min(segment.a.y, segment.b.y);
      const maxY = Math.max(segment.a.y, segment.b.y);
      if (
        box.x < maxX + LABEL_GAP / 2 &&
        box.x + box.width > minX - LABEL_GAP / 2 &&
        box.y < maxY + LABEL_GAP / 2 &&
        box.y + box.height > minY - LABEL_GAP / 2
      ) {
        return true;
      }
    }
  }

  for (const node of nodes.values()) {
    if (
      box.x < rightEdge(node.box) - 2 &&
      box.x + box.width > node.box.x + 2 &&
      box.y < bottomEdge(node.box) - 2 &&
      box.y + box.height > node.box.y + 2
    ) {
      return true;
    }
  }

  return false;
}

function moveLabel(label: SVGGElement, box: Box, target: Point): void {
  const current = centerOf(box);
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const existing = label.getAttribute("transform") ?? "";
  const translate = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(existing);
  const baseX = translate ? Number(translate[1]) : 0;
  const baseY = translate ? Number(translate[2]) : 0;
  label.setAttribute("transform", `translate(${baseX + dx}, ${baseY + dy})`);
}

function placeLabels(
  svg: SVGSVGElement,
  edges: CollectedEdge[],
  routes: Map<string, RouteResult>,
  nodes: Map<string, CollectedNode>,
): void {
  const labels = new Map<string, LabelBox>();
  for (const label of svg.querySelectorAll<SVGGElement>("g.edgeLabel")) {
    const key = edgeKeyFromLabel(label);
    if (!key) continue;
    labels.set(key, { el: label, box: userBox(label) });
  }

  for (const edge of edges) {
    const result = routes.get(edge.id);
    const label = labels.get(edge.id);
    if (!result || result.failed || !label) continue;

    // Longest segments first: a label belongs beside the calmest part of its
    // own edge, not on top of a neighbour's line.
    const segments = segmentsOf(result.points).sort(
      (a, b) =>
        Math.abs(b.a.x - b.b.x) +
        Math.abs(b.a.y - b.b.y) -
        (Math.abs(a.a.x - a.b.x) + Math.abs(a.a.y - a.b.y)),
    );

    for (const segment of segments) {
      const placement = placeLabel(label, segment, routes, edge.id, nodes);
      if (!placement) continue;
      moveLabel(label.el, label.box, placement);
      label.box = {
        x: placement.x - label.box.width / 2,
        y: placement.y - label.box.height / 2,
        width: label.box.width,
        height: label.box.height,
      };
      break;
    }
  }
}

/** Find a free spot beside one segment, or null when the label does not fit. */
function placeLabel(
  label: LabelBox,
  segment: { a: Point; b: Point },
  routes: Map<string, RouteResult>,
  ownId: string,
  nodes: Map<string, CollectedNode>,
): Point | null {
  const horizontal = Math.abs(segment.a.y - segment.b.y) < 0.5;
  const along = horizontal ? Math.abs(segment.a.x - segment.b.x) : Math.abs(segment.a.y - segment.b.y);
  const needed = horizontal ? label.box.width : label.box.height;
  if (along < needed + LABEL_GAP) return null;

  const mid = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
  const offsets = horizontal
    ? [mid.y - (label.box.height / 2 + LABEL_GAP), mid.y + (label.box.height / 2 + LABEL_GAP)]
    : [mid.x + label.box.width / 2 + LABEL_GAP, mid.x - label.box.width / 2 - LABEL_GAP];

  for (const side of offsets) {
    for (const shift of [0, 16, -16, 32, -32, 48, -48]) {
      const target = horizontal ? { x: mid.x + shift, y: side } : { x: side, y: mid.y + shift };
      const candidate: Box = {
        x: target.x - label.box.width / 2,
        y: target.y - label.box.height / 2,
        width: label.box.width,
        height: label.box.height,
      };
      if (!labelIntersects(candidate, routes, ownId, nodes)) return target;
    }
  }
  return null;
}

/** Enable the dotted connector Mermaid draws between a state and its note. */
function styleNoteEdge(path: SVGPathElement): void {
  path.style.strokeDasharray = "4 4";
  path.style.strokeLinecap = "round";
}

/**
 * Put the state note to the right of its state, below the self-loop, as the
 * reference layout requires. Returns false when there is no safe place.
 */
function moveNoteRight(nodes: Map<string, CollectedNode>): boolean {
  const note = [...nodes.values()].find((node) => node.kind === "note");
  const host = [...nodes.values()].find(
    (node) => node.kind !== "note" && /reserved/i.test(node.id.replace(/^.*-state-/, "")),
  );
  if (!note || !host || note.box.x > host.box.x) return false;

  const dx = rightEdge(host.box) + 16 - note.box.x;
  const dy = bottomEdge(host.box) + 24 - note.box.y;
  const moved: Box = { ...note.box, x: note.box.x + dx, y: note.box.y + dy };

  for (const node of nodes.values()) {
    if (node.id === note.id) continue;
    if (
      moved.x < rightEdge(node.box) + 2 &&
      moved.x + moved.width > node.box.x - 2 &&
      moved.y < bottomEdge(node.box) + 2 &&
      moved.y + moved.height > node.box.y - 2
    ) {
      return false;
    }
  }

  const transform = note.el.getAttribute("transform") ?? "";
  const translate = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(transform);
  if (!translate) return false;
  note.el.setAttribute("transform", `translate(${Number(translate[1]) + dx}, ${Number(translate[2]) + dy})`);
  note.box = moved;
  return true;
}

function fitViewBox(svg: SVGSVGElement): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (box: Box) => {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  };

  for (const node of svg.querySelectorAll<SVGGElement>("g.node")) {
    const shape = node.querySelector<SVGGraphicsElement>("rect, path, circle, polygon, ellipse");
    if (shape) include(userBox(shape));
  }
  for (const path of svg.querySelectorAll<SVGPathElement>("g.edgePaths > path, g.edgePath > path")) {
    if (!path.getAttribute("d")) continue;
    include(userBox(path));
  }
  for (const label of svg.querySelectorAll<SVGGElement>("g.edgeLabel")) {
    if (!label.textContent?.trim()) continue;
    include(userBox(label));
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  const x = Math.floor(minX - VIEW_PADDING);
  const y = Math.floor(minY - VIEW_PADDING);
  const width = Math.ceil(maxX - minX + VIEW_PADDING * 2);
  const height = Math.ceil(maxY - minY + VIEW_PADDING * 2);
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
}

function routeSvg(svg: SVGSVGElement): boolean {
  const type = svg.getAttribute("aria-roledescription") ?? "";
  if (!/flowchart|stateDiagram/.test(type)) return false;

  // Clustered layouts can use separate coordinate systems for their paths
  // and nodes. Keep Mermaid's routes, labels and viewport together.
  if (isClusteredFlowchart(svg)) return false;

  const nodes = collectNodes(svg);
  if (nodes.size < 2) return false;

  // Identify the endpoints against Mermaid's own coordinates first: moving the
  // note would break the geometric matching that names the note edge.
  const edges = collectEdges(svg, nodes);
  if (edges.length === 0) return false;

  if (/stateDiagram/.test(type)) moveNoteRight(nodes);

  const router = new OrthogonalRouter(nodes.values());
  const routes = router.route(
    edges.map((edge): RouteEdge => ({ id: edge.id, from: edge.from, to: edge.to })),
  );

  let applied = false;
  for (const edge of edges) {
    const result = routes.get(edge.id);
    if (result?.failed && import.meta.env.DEV) {
      console.warn(`[mermaid] kept Mermaid route for ${edge.id}: ${result.reason ?? "?"}`);
    }
    if (!result || result.failed || result.points.length < 2) continue;
    if (!isOrthogonal(result.points)) continue;
    edge.el.setAttribute("d", toPathData(result.points));
    if (edge.noteEdge) styleNoteEdge(edge.el);
    applied = true;
  }

  if (!applied) return false;

  placeLabels(svg, edges, routes, nodes);
  fitViewBox(svg);
  void MARKER_CLEARANCE;
  return true;
}

/**
 * True for a flowchart that Mermaid drew with clusters (subgraphs).
 *
 * Clustered layouts are left exactly as Mermaid rendered them: the router
 * reads node boxes in SVG user coordinates while a path's `d` lives in the
 * coordinates of its own group, so re-routing a clustered graph moved arrows
 * away from their shapes. Flat flowcharts and state diagrams are unaffected.
 */
export function isClusteredFlowchart(svg: SVGSVGElement): boolean {
  const type = svg.getAttribute("aria-roledescription") ?? "";
  if (!/flowchart/.test(type)) return false;
  return Boolean(svg.querySelector("g.cluster, g.clusters > g, g.subgraph, g.subgraphs > g"));
}

/** Rewrite Mermaid's SVG with orthogonal routes.
 *
 * Returns the input unchanged when the diagram type is unsupported, when the
 * geometry cannot be read reliably, or when DOM measurement is unavailable.
 */
export function improveOrthogonalRoutes(svgText: string): string {
  if (typeof document === "undefined" || typeof DOMPoint === "undefined") return svgText;

  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText =
    "position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;";
  document.body.appendChild(holder);

  try {
    holder.innerHTML = svgText;
    const svg = holder.querySelector("svg");
    if (!svg) return svgText;
    if (!routeSvg(svg)) return svgText;
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return svgText;
  } finally {
    holder.remove();
  }
}
