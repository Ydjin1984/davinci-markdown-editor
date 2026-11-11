/** The DaVinci palette: colour math, contrast guarantees and theme wiring. */

import { describe, expect, it } from "vitest";

import {
  DIAGRAM_ROLES,
  PALETTES,
  PALETTE_VERSION,
  contrastRatio,
  davinciTheme,
  templateClassDefs,
  type Appearance,
  type DiagramRole,
} from "@/mermaid/theme";

const APPEARANCES: Appearance[] = ["dark", "light"];

describe("contrastRatio", () => {
  it("returns the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#152d48", "#f1f5f9")).toBeCloseTo(contrastRatio("#f1f5f9", "#152d48"), 10);
  });

  it("accepts short hex and rgb()", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
    expect(contrastRatio("rgb(255, 255, 255)", "#000000")).toBeCloseTo(21, 5);
  });

  it("rejects a value it cannot parse instead of guessing", () => {
    expect(() => contrastRatio("not-a-colour", "#ffffff")).toThrow(/Unsupported colour/);
  });
});

describe("DaVinci palette", () => {
  it("declares a version", () => {
    expect(PALETTE_VERSION).toMatch(/^davinci-\d+$/);
  });

  it("defines every semantic role in both appearances", () => {
    for (const appearance of APPEARANCES) {
      for (const role of DIAGRAM_ROLES) {
        const colours = PALETTES[appearance].roles[role];
        expect(colours.fill, `${appearance}/${role} fill`).toMatch(/^#[0-9a-f]{6}$/);
        expect(colours.stroke, `${appearance}/${role} stroke`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  for (const appearance of APPEARANCES) {
    it(`keeps ordinary text at ≥4.5:1 on every ${appearance} role fill`, () => {
      const palette = PALETTES[appearance];
      for (const role of DIAGRAM_ROLES) {
        const ratio = contrastRatio(palette.text, palette.roles[role].fill);
        expect(ratio, `${appearance}/${role} text contrast is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });

    it(`keeps ${appearance} shape borders distinguishable (≥3:1 against the fill)`, () => {
      const palette = PALETTES[appearance];
      for (const role of DIAGRAM_ROLES) {
        const ratio = contrastRatio(palette.roles[role].stroke, palette.roles[role].fill);
        expect(
          ratio,
          `${appearance}/${role} border contrast is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it(`keeps ${appearance} text readable on the page background`, () => {
      expect(
        contrastRatio(PALETTES[appearance].text, PALETTES[appearance].background),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("davinciTheme", () => {
  it("produces variables Mermaid's base theme understands", () => {
    const { themeVariables } = davinciTheme("dark");

    for (const key of [
      "background",
      "primaryColor",
      "primaryTextColor",
      "primaryBorderColor",
      "lineColor",
      "textColor",
      "nodeTextColor",
      "edgeLabelBackground",
      "actorBkg",
      "noteBkgColor",
      "taskBkgColor",
      "pie1",
      "git0",
      "cScale0",
    ]) {
      expect(themeVariables[key], key).toBeTruthy();
    }

    expect(themeVariables.darkMode).toBe(true);
    expect(themeVariables.primaryColor).toBe(PALETTES.dark.roles.action.fill);
    expect(themeVariables.lineColor).toBe(PALETTES.dark.line);
  });

  it("follows the appearance", () => {
    const dark = davinciTheme("dark").themeVariables;
    const light = davinciTheme("light").themeVariables;
    expect(light.darkMode).toBe(false);
    expect(light.primaryColor).toBe(PALETTES.light.roles.action.fill);
    expect(light.primaryColor).not.toBe(dark.primaryColor);
  });

  it("does not override author fills with !important", () => {
    const { themeCSS } = davinciTheme("light");
    expect(themeCSS).not.toContain("!important");
    // Geometry (rx/ry) is allowed; colour rules on node rectangles are not —
    // they would erase a document's own classDef/style.
    expect(themeCSS).not.toMatch(/\.node\s+rect[^{]*\{[^}]*\b(fill|stroke)\s*:/);
    expect(themeCSS).toContain("rect.label-container");
    expect(themeCSS).toContain("edgeLabel");
  });
});

describe("templateClassDefs", () => {
  it("writes a classDef for every role", () => {
    const lines = templateClassDefs("dark").split("\n");
    expect(lines).toHaveLength(DIAGRAM_ROLES.length);

    for (const role of DIAGRAM_ROLES) {
      const line = lines.find((candidate) => candidate.includes(`classDef ${role} `));
      expect(line, role).toBeTruthy();
      expect(line).toContain(PALETTES.dark.roles[role].fill);
      expect(line).toContain(PALETTES.dark.roles[role].stroke);
    }
  });

  it("uses the requested appearance", () => {
    const light = templateClassDefs("light");
    for (const role of DIAGRAM_ROLES) {
      expect(light).toContain(PALETTES.light.roles[role].fill);
    }
  });
});

describe("palette role coverage", () => {
  it("uses a distinct fill per role so colour is not the only differentiator", () => {
    for (const appearance of APPEARANCES) {
      const fills = new Set(DIAGRAM_ROLES.map((role: DiagramRole) => PALETTES[appearance].roles[role].fill));
      expect(fills.size).toBe(DIAGRAM_ROLES.length);
    }
  });
});
