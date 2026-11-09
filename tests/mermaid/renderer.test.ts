/** The renderer's pure decisions: effective theme, config and cache key. */

import { describe, expect, it } from "vitest";

import { RENDER_VERSION, diagramCacheKey, effectiveMermaidTheme, mermaidConfig } from "@/mermaid/renderer";
import { PALETTE_VERSION } from "@/mermaid/theme";

describe("effectiveMermaidTheme", () => {
  it("turns auto into the DaVinci palette", () => {
    expect(effectiveMermaidTheme("dark", "auto")).toBe("davinci");
    expect(effectiveMermaidTheme("light", "auto")).toBe("davinci");
  });

  it("keeps an explicit user choice", () => {
    for (const theme of ["default", "dark", "forest", "neutral", "base"] as const) {
      expect(effectiveMermaidTheme("dark", theme)).toBe(theme);
    }
  });
});

describe("mermaidConfig", () => {
  it("uses base + variables + CSS for DaVinci", () => {
    const config = mermaidConfig({ appearance: "dark", theme: "auto" });

    expect(config.theme).toBe("base");
    expect(config.themeVariables).toBeTruthy();
    expect(config.themeVariables?.darkMode).toBe(true);
    expect(config.themeCSS).toContain("edgeLabel");
  });

  it("enforces the layout contract", () => {
    const config = mermaidConfig({ appearance: "light", theme: "auto" });

    expect(config.securityLevel).toBe("strict");
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.htmlLabels).toBe(false);
    expect(config.flowchart?.htmlLabels).toBe(false);
    expect(config.flowchart?.useMaxWidth).toBe(false);
    expect(config.sequence?.useMaxWidth).toBe(false);
    expect(config.pie?.useMaxWidth).toBe(false);
  });

  it("passes an explicit theme through without the DaVinci variables", () => {
    const config = mermaidConfig({ appearance: "dark", theme: "forest" });

    expect(config.theme).toBe("forest");
    expect(config.themeVariables).toBeUndefined();
    expect(config.themeCSS).toBeUndefined();
  });

  it("follows the appearance", () => {
    const dark = mermaidConfig({ appearance: "dark", theme: "auto" }).themeVariables;
    const light = mermaidConfig({ appearance: "light", theme: "auto" }).themeVariables;
    expect(dark?.primaryColor).not.toBe(light?.primaryColor);
  });
});

describe("diagramCacheKey", () => {
  const base = { appearance: "dark", theme: "auto" } as const;

  it("is stable for the same inputs", () => {
    expect(diagramCacheKey("flowchart TD\n A-->B", base)).toBe(diagramCacheKey("flowchart TD\n A-->B", base));
  });

  it("includes the source", () => {
    expect(diagramCacheKey("A", base)).not.toBe(diagramCacheKey("B", base));
  });

  it("includes the appearance", () => {
    expect(diagramCacheKey("A", { ...base, appearance: "dark" })).not.toBe(
      diagramCacheKey("A", { ...base, appearance: "light" }),
    );
  });

  it("includes the effective theme", () => {
    expect(diagramCacheKey("A", base)).not.toBe(diagramCacheKey("A", { ...base, theme: "forest" }));
  });

  it("includes the palette and renderer versions", () => {
    const key = diagramCacheKey("A", base);
    expect(key).toContain(PALETTE_VERSION);
    expect(key).toContain(RENDER_VERSION);
  });

  it("separates fields with a delimiter that cannot appear in Markdown", () => {
    expect(diagramCacheKey("A", base)).toContain("\u0000");
  });
});
