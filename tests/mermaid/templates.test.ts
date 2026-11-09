/** Insert → Diagram templates: colours, Russian content and i18n keys. */

import { describe, expect, it } from "vitest";

import { DIAGRAM_TEMPLATES, fencedDiagram } from "@/mermaid/templates";
import { DIAGRAM_ROLES, templateClassDefs } from "@/mermaid/theme";
import { t } from "@/shared/i18n";

const CYRILLIC = /[А-Яа-яЁё]/;

describe("diagram templates", () => {
  it("offers all ten Mermaid diagram types", () => {
    expect(DIAGRAM_TEMPLATES).toHaveLength(10);
    expect(DIAGRAM_TEMPLATES.map((template) => template.id)).toEqual([
      "flowchart",
      "sequence",
      "class",
      "state",
      "er",
      "gantt",
      "gitgraph",
      "mindmap",
      "timeline",
      "pie",
    ]);
  });

  it("uses a unique id and a real i18n key per template", () => {
    const ids = new Set<string>();
    for (const template of DIAGRAM_TEMPLATES) {
      expect(ids.has(template.id), `duplicate id ${template.id}`).toBe(false);
      ids.add(template.id);

      expect(template.labelKey).toBe(`insert.diagram.${template.id}`);
      // A key that has no entry falls back to the key itself, so this catches a
      // missing translation without importing the string table.
      expect(t(template.labelKey)).not.toBe(template.labelKey);
      expect(template.label).toBe(t(template.labelKey));
    }
  });

  it("keeps every in-diagram label in Russian", () => {
    for (const template of DIAGRAM_TEMPLATES) {
      expect(CYRILLIC.test(template.source), `${template.id} has no Russian label`).toBe(true);
    }
  });

  it("uses the flow-chart hint that matches its fence language", () => {
    for (const template of DIAGRAM_TEMPLATES) {
      expect(template.source.split("\n")[0]!.toLowerCase()).toContain(template.hint.toLowerCase());
    }
  });
});

describe("colourful flowchart template", () => {
  const flowchart = DIAGRAM_TEMPLATES.find((template) => template.id === "flowchart")!;

  it("declares a classDef for every semantic role", () => {
    for (const role of DIAGRAM_ROLES) {
      expect(flowchart.source, `${role} classDef missing`).toContain(`classDef ${role} `);
      expect(flowchart.source, `${role} is never applied`).toContain(`:::${role}`);
    }
  });

  it("matches the palette exactly", () => {
    expect(flowchart.source).toContain(templateClassDefs("dark").trimStart());
  });

  it("marks the branches Да/Нет", () => {
    expect(flowchart.source).toContain("-->|Да|");
    expect(flowchart.source).toContain("-->|Нет|");
  });
});

describe("fencedDiagram", () => {
  it("wraps the source in a mermaid fence", () => {
    const template = DIAGRAM_TEMPLATES[0]!;
    const fenced = fencedDiagram(template);

    expect(fenced.startsWith("```mermaid\n")).toBe(true);
    expect(fenced.endsWith("\n```\n")).toBe(true);
    expect(fenced).toContain(template.source);
  });
});
