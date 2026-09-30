/** Mermaid detection, code block handling and math rendering. */

import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/markdown/renderer/pipeline";

const options = { allowRawHtml: true, renderMath: true } as const;

describe("mermaid block detection", () => {
  it("turns a mermaid fence into a diagram container", async () => {
    const source = ["```mermaid", "flowchart LR", "    A --> B", "```"].join("\n");
    const { html, diagrams } = await renderMarkdown(source, options);

    expect(html).toContain('class="md-diagram"');
    expect(html).toContain('data-diagram-state="pending"');
    expect(diagrams).toEqual(["flowchart LR\n    A --> B"]);
  });

  it("keeps the diagram source inside the container as text", async () => {
    const source = ["```mermaid", "flowchart LR", "    A --> B", "```"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("md-diagram-source");
    // Stored as escaped text for the renderer to read back.
    expect(html).toContain("A --");
  });

  it("does not treat other fences as diagrams", async () => {
    const source = ["```json", '{"a": 1}', "```"].join("\n");
    const { html, diagrams } = await renderMarkdown(source, options);

    expect(diagrams).toEqual([]);
    expect(html).not.toContain("md-diagram");
    expect(html).toContain("md-code");
  });

  it("recognises every required diagram type", async () => {
    const types = [
      "flowchart LR\n  A --> B",
      "sequenceDiagram\n  A->>B: hi",
      "classDiagram\n  class A",
      "stateDiagram-v2\n  [*] --> A",
      "erDiagram\n  A ||--o{ B : has",
      "gantt\n  title T\n  section S\n  task :a1, 2026-01-01, 1d",
      "gitGraph\n  commit",
      "mindmap\n  root((x))",
      "timeline\n  title T\n  2026 : event",
      'pie title T\n  "a" : 1',
    ];

    for (const source of types) {
      const { diagrams } = await renderMarkdown(`\`\`\`mermaid\n${source}\n\`\`\``, options);
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0]).toBe(source);
    }
  });

  it("collects several diagrams in document order", async () => {
    const source = [
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "```mermaid",
      "pie title P",
      '  "x" : 1',
      "```",
    ].join("\n");
    const { diagrams } = await renderMarkdown(source, options);

    expect(diagrams).toHaveLength(2);
    expect(diagrams[0]).toContain("flowchart");
    expect(diagrams[1]).toContain("pie");
  });

  it("does not let a broken diagram block affect the rest of the document", async () => {
    const source = [
      "# Title",
      "",
      "```mermaid",
      "flowchart LR",
      "  this line is nonsense ~~~",
      "```",
      "",
      "Trailing text",
    ].join("\n");
    const { html, diagrams } = await renderMarkdown(source, options);

    // Detection is purely syntactic, so the block is still handed to the
    // renderer; the failure is reported per block at render time.
    expect(diagrams).toHaveLength(1);
    expect(html).toContain(">Title</h1>");
    expect(html).toContain("Trailing text");
  });
});

describe("code blocks", () => {
  it("labels a fenced block with its language and offers a copy button", async () => {
    const { html } = await renderMarkdown("```rust\nfn main() {}\n```", options);

    expect(html).toContain("md-code");
    expect(html).toContain('data-lang="rust"');
    expect(html).toContain("md-code-copy");
  });

  it("maps common fence aliases", async () => {
    const { html } = await renderMarkdown("```js\nlet a = 1;\n```", options);
    expect(html).toContain('data-lang="javascript"');
  });

  it("leaves an unknown language as plain text", async () => {
    const { html } = await renderMarkdown("```not-a-real-language\nsome text\n```", options);

    expect(html).toContain("md-code");
    expect(html).toContain("some text");
  });

  it("escapes HTML inside a code block", async () => {
    const { html } = await renderMarkdown("```html\n<script>alert(1)</script>\n```", options);
    expect(html).not.toMatch(/<script/i);
    // `hast` escapes `<` as `&#x3C;`; either form is inert text.
    expect(html).toMatch(/&#x3C;|&lt;/);
    expect(html).toContain("script");
  });

  it("adds a source line marker for scroll synchronisation", async () => {
    const source = ["Paragraph one.", "", "```js", "let a = 1;", "```"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="3"');
  });
});

describe("math", () => {
  it("renders inline math", async () => {
    const { html } = await renderMarkdown("Energy is $E = mc^2$ exactly.", options);
    expect(html).toContain("katex");
    expect(html).not.toContain("$E = mc^2$");
  });

  it("renders display math", async () => {
    const source = "$$\nP(A|B)=\\frac{P(B|A)P(A)}{P(B)}\n$$";
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("katex-display");
  });

  it("reports a malformed formula without breaking the document", async () => {
    const source = ["Before", "", "$\\frac{1}{$", "", "After"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).not.toContain("md-render-error");
  });

  it("skips math when the setting is off", async () => {
    const { html } = await renderMarkdown("Inline $E = mc^2$ here.", {
      allowRawHtml: true,
      renderMath: false,
    });

    expect(html).not.toContain("katex");
    expect(html).toContain("$E = mc^2$");
  });
});

describe("source line markers", () => {
  it("marks block elements with their Markdown line", async () => {
    const source = ["# Heading", "", "Paragraph.", "", "> Quote", "", "- item"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="3"');
    expect(html).toContain('data-line="5"');
    expect(html).toContain('data-line="7"');
  });
});
