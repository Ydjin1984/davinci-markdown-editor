/**
 * The DaVinci Mermaid palette.
 *
 * The colours are the ones from `DaVinci_Render_TZ.md` §4.1. They are applied in
 * two places, and only these two:
 *
 * 1. `davinciTheme()` feeds Mermaid's `base` theme through `themeVariables` and
 *    `themeCSS`, so a diagram without its own colours still gets filled shapes
 *    and readable borders.
 * 2. `templateClassDefs()` writes the semantic roles (action / condition /
 *    success / error / data) into the inserted flowchart source, because Mermaid
 *    cannot infer meaning from an arbitrary node.
 *
 * The precedence the ТЗ asks for — the author's own `style`/`classDef`, then the
 * template role, then the application theme — falls out of that split: a
 * `classDef` in the document wins over theme variables, and Mermaid's own
 * defaults never get `!important` overrides here.
 */

export type Appearance = "light" | "dark";

/** Semantic roles used by the flowchart template and its `classDef` lines. */
export type DiagramRole = "action" | "condition" | "success" | "error" | "data";

export const DIAGRAM_ROLES: readonly DiagramRole[] = [
  "action",
  "condition",
  "success",
  "error",
  "data",
] as const;

export interface RoleColors {
  fill: string;
  stroke: string;
}

export interface DiagramPalette {
  /** Page/canvas colour behind the diagram. */
  background: string;
  /** Ordinary label text, checked for ≥4.5:1 against every role fill. */
  text: string;
  /** Arrows, borders and other lines. */
  line: string;
  /** Background of edge labels, so a label never sits directly on a line. */
  edgeLabelBackground: string;
  roles: Record<DiagramRole, RoleColors>;
  /** Distinct hues for pie/git/timeline/mindmap categories. */
  categorical: readonly string[];
}

/**
 * Bumped whenever a colour changes. It is part of both the Mermaid
 * initialisation key and the SVG cache key, so an upgrade can never serve a
 * stale colour.
 */
export const PALETTE_VERSION = "davinci-2";

export const PALETTES: Record<Appearance, DiagramPalette> = {
  dark: {
    background: "#0d1117",
    text: "#f1f5f9",
    line: "#94a3b8",
    edgeLabelBackground: "#1e293b",
    roles: {
      action: { fill: "#152d48", stroke: "#60a5fa" },
      condition: { fill: "#3c2e12", stroke: "#fbbf24" },
      success: { fill: "#12382c", stroke: "#34d399" },
      error: { fill: "#431e28", stroke: "#fb7185" },
      data: { fill: "#30214a", stroke: "#a78bfa" },
    },
    categorical: [
      "#60a5fa",
      "#fbbf24",
      "#34d399",
      "#fb7185",
      "#a78bfa",
      "#38bdf8",
      "#f472b6",
      "#facc15",
      "#4ade80",
      "#c084fc",
      "#94a3b8",
      "#2dd4bf",
    ],
  },
  light: {
    background: "#ffffff",
    text: "#172033",
    line: "#526176",
    edgeLabelBackground: "#f1f5f9",
    roles: {
      action: { fill: "#dbeafe", stroke: "#2563eb" },
      condition: { fill: "#fef3c7", stroke: "#b45309" },
      success: { fill: "#d1fae5", stroke: "#047857" },
      error: { fill: "#ffe4e6", stroke: "#be123c" },
      data: { fill: "#ede9fe", stroke: "#7c3aed" },
    },
    categorical: [
      "#2563eb",
      "#b45309",
      "#047857",
      "#be123c",
      "#7c3aed",
      "#0284c7",
      "#db2777",
      "#ca8a04",
      "#15803d",
      "#9333ea",
      "#526176",
      "#0f766e",
    ],
  },
};

/**
 * One font family for measuring and drawing. Mermaid measures label widths
 * with the `fontFamily` config value and paints them with the theme variable,
 * so both have to be the same string.
 */
export const DIAGRAM_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

/** Resolve a CSS colour token (`#rgb`, `#rrggbb`, `rgb()`) to linear RGB. */
function parseColour(input: string): [number, number, number] {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits = hex[1]!;
    const expanded =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    return [
      Number.parseInt(expanded.slice(0, 2), 16) / 255,
      Number.parseInt(expanded.slice(2, 4), 16) / 255,
      Number.parseInt(expanded.slice(4, 6), 16) / 255,
    ];
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(value);
  if (rgb) {
    return [
      Math.min(255, Number(rgb[1])) / 255,
      Math.min(255, Number(rgb[2])) / 255,
      Math.min(255, Number(rgb[3])) / 255,
    ];
  }

  throw new Error(`Unsupported colour value: ${input}`);
}

function relativeLuminance(input: string): number {
  const [r, g, b] = parseColour(input).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x contrast ratio between two opaque colours (1..21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `classDef` lines for the semantic roles, derived from the palette so the
 * template and the theme can never drift apart.
 */
export function templateClassDefs(appearance: Appearance = "dark"): string {
  const palette = PALETTES[appearance];
  return DIAGRAM_ROLES.map((role) => {
    const { fill, stroke } = palette.roles[role];
    return `    classDef ${role} fill:${fill},stroke:${stroke},color:${palette.text},stroke-width:2px`;
  }).join("\n");
}

/** Inline `:::` role suffix for a flow-chart node, e.g. `A["Открыть"]:::action`. */
export function roleMarker(role: DiagramRole): string {
  return `:::${role}`;
}

export interface DavinciTheme {
  themeVariables: Record<string, string | boolean>;
  themeCSS: string;
}

/**
 * Mermaid `base` theme variables for one appearance.
 *
 * Only variables that carry meaning are set explicit colours; everything else
 * inherits from `base`, which keeps the result working across Mermaid upgrades
 * instead of freezing a private copy of its whole theme.
 */
export function davinciTheme(appearance: Appearance): DavinciTheme {
  const palette = PALETTES[appearance];
  const dark = appearance === "dark";
  const [c0, c1, c2, c3, c4, c5] = palette.categorical;

  const themeVariables: Record<string, string | boolean> = {
    darkMode: dark,
    background: palette.background,
    fontFamily: DIAGRAM_FONT_FAMILY,
    fontSize: "16px",

    // Nodes and clusters -----------------------------------------------------
    primaryColor: palette.roles.action.fill,
    primaryTextColor: palette.text,
    primaryBorderColor: palette.roles.action.stroke,
    secondaryColor: palette.roles.success.fill,
    secondaryTextColor: palette.text,
    secondaryBorderColor: palette.roles.success.stroke,
    tertiaryColor: palette.roles.data.fill,
    tertiaryTextColor: palette.text,
    tertiaryBorderColor: palette.roles.data.stroke,
    mainBkg: palette.roles.action.fill,
    nodeBorder: palette.roles.action.stroke,
    nodeTextColor: palette.text,
    textColor: palette.text,
    titleColor: palette.text,
    lineColor: palette.line,
    clusterBkg: dark ? "#111827" : "#f8fafc",
    clusterBorder: dark ? "#475569" : "#94a3b8",
    edgeLabelBackground: palette.edgeLabelBackground,
    labelBackground: palette.edgeLabelBackground,

    // Sequence ---------------------------------------------------------------
    actorBkg: palette.roles.action.fill,
    actorBorder: palette.roles.action.stroke,
    actorTextColor: palette.text,
    actorLineColor: palette.line,
    signalColor: palette.line,
    signalTextColor: palette.text,
    labelBoxBkgColor: palette.roles.success.fill,
    labelBoxBorderColor: palette.roles.success.stroke,
    labelTextColor: palette.text,
    loopTextColor: palette.text,
    noteBkgColor: palette.roles.condition.fill,
    noteTextColor: palette.text,
    noteBorderColor: palette.roles.condition.stroke,
    activationBkgColor: palette.roles.data.fill,
    activationBorderColor: palette.roles.data.stroke,
    sequenceNumberColor: palette.background,

    // Gantt ------------------------------------------------------------------
    sectionBkgColor: dark ? "#0f172a" : "#f8fafc",
    altSectionBkgColor: dark ? "#111827" : "#ffffff",
    sectionBkgColor2: dark ? "#0f172a" : "#f8fafc",
    taskBkgColor: palette.roles.action.stroke,
    taskTextColor: dark ? palette.background : "#ffffff",
    taskTextDarkColor: palette.background,
    taskTextOutsideColor: palette.text,
    activeTaskBkgColor: palette.roles.condition.stroke,
    activeTaskBorderColor: palette.roles.condition.stroke,
    doneTaskBkgColor: palette.roles.success.stroke,
    doneTaskBorderColor: palette.roles.success.stroke,
    critBkgColor: palette.roles.error.fill,
    critBorderColor: palette.roles.error.stroke,
    gridColor: palette.line,
    todayLineColor: palette.roles.data.stroke,

    // ER / class -------------------------------------------------------------
    attributeBackgroundColorOdd: dark ? "#152d48" : "#eef2ff",
    attributeBackgroundColorEven: dark ? "#0f2438" : "#ffffff",
    relationLabelColor: palette.text,
    relationLabelBackground: palette.edgeLabelBackground,

    // Categorical scales (pie, git graph, mindmap, timeline) -----------------
    pie1: c0,
    pie2: c1,
    pie3: c2,
    pie4: c3,
    pie5: c4,
    pie6: c5,
    pie7: c0,
    pie8: c1,
    pie9: c2,
    pie10: c3,
    pie11: c4,
    pie12: c5,
    pieTitleTextColor: palette.text,
    pieSectionTextColor: dark ? palette.background : "#ffffff",
    pieLegendTextColor: palette.text,
    pieStrokeColor: palette.background,
    pieOuterStrokeColor: palette.line,

    git0: c0,
    git1: c1,
    git2: c2,
    git3: c3,
    git4: c4,
    git5: c5,
    git6: c0,
    git7: c1,
    gitBranchLabel0: palette.background,
    gitBranchLabel1: palette.background,
    gitBranchLabel2: palette.background,
    gitBranchLabel3: palette.background,
    commitLabelColor: palette.text,
    commitLabelBackground: palette.edgeLabelBackground,
    tagLabelColor: palette.background,
    tagLabelBackground: palette.roles.success.stroke,
    gitInv0: palette.background,
    gitInv1: palette.background,
    gitInv2: palette.background,
    gitInv3: palette.background,

    cScale0: c0,
    cScale1: c1,
    cScale2: c2,
    cScale3: c3,
    cScale4: c4,
    cScale5: c5,
    cScale6: c0,
    cScale7: c1,
    cScale8: c2,
    cScale9: c3,
    cScale10: c4,
    cScale11: c5,
  };

  // Deliberately narrow: it repairs label backgrounds Mermaid leaves
  // transparent and never touches `.node rect { fill }`, which is what the ТЗ
  // forbids and what would erase a document's own `classDef`/`style`. The
  // geometry rules below only shape what Mermaid draws itself: a rectangle's
  // corner radius, the weight of the first text row in a node (its title), and
  // the stroke of an edge path. Author `style`/`linkStyle` win because they are
  // inline and this is a stylesheet.
  const themeCSS = [
    `.edgeLabel rect, .edgeLabel .labelBkg { fill: ${palette.edgeLabelBackground}; stroke: none; }`,
    `.edgeLabel text, .edgeLabel tspan { fill: ${palette.text}; }`,
    `.cluster-label text, .cluster-label span { fill: ${palette.text}; }`,
    `.sectionTitle text, .titleText { fill: ${palette.text}; }`,
    // Rounded rectangles only: diamonds are polygons, cylinders are paths.
    `.node rect.label-container { rx: 4px; ry: 4px; }`,
    // The first text row of a node is its title; edge labels stay regular.
    `.node text > tspan.row:first-of-type .text-inner-tspan { font-weight: 600; }`,
    `.edgePaths path, .edgePath path { stroke-width: 1.6px; }`,
    `.edgeLabel text, .edgeLabel .text-inner-tspan { font-weight: 400; }`,
  ].join("\n");

  return { themeVariables, themeCSS };
}
