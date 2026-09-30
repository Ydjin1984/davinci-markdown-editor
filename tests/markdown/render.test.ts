/** CommonMark and GFM rendering coverage. */

import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/markdown/renderer/pipeline";

const options = { allowRawHtml: true, renderMath: true } as const;

describe("CommonMark", () => {
  it("renders headings, paragraphs and emphasis", async () => {
    const { html } = await renderMarkdown("# Title\n\nSome **bold** and *italic* text.", options);

    expect(html).toContain("<h1");
    expect(html).toContain(">Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders nested lists", async () => {
    const source = ["- one", "  - nested", "  - also nested", "- two"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("<ul");
    expect(html.match(/<ul/g)?.length).toBe(2);
    expect(html).toContain("nested");
  });

  it("renders ordered lists starting at the given number", async () => {
    const { html } = await renderMarkdown("3. three\n4. four", options);
    expect(html).toContain('start="3"');
  });

  it("renders blockquotes and rules", async () => {
    const { html } = await renderMarkdown("> quoted\n\n---\n", options);
    expect(html).toContain("<blockquote");
    // The source-line marker adds an attribute, so match the tag not `<hr>`.
    expect(html).toContain("<hr");
  });

  it("renders inline code and fenced code", async () => {
    const source = "Use `npm install` here.\n\n```\nplain block\n```";
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("<code>npm install</code>");
    expect(html).toContain("plain block");
  });

  it("renders links and images", async () => {
    const { html } = await renderMarkdown("[docs](https://example.com)\n\n![alt](pic.png)", options);

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('alt="alt"');
    expect(html).toContain("pic.png");
  });

  it("escapes angle brackets in plain text", async () => {
    const { html } = await renderMarkdown("a < b > c", options);
    // hast escapes `<` as `&#x3C;` and leaves `>` alone; both forms are inert.
    expect(html).toContain("a ");
    expect(html).toContain("&#x3C;");
    expect(html).not.toContain("<b>");
  });
});

describe("GitHub Flavored Markdown", () => {
  it("renders tables with alignment", async () => {
    const source = ["| Left | Center | Right |", "|:-----|:------:|------:|", "| a | b | c |"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("<table");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain('align="center"');
    expect(html).toContain('align="right"');
  });

  it("renders task list checkboxes with their state", async () => {
    const source = ["- [x] done", "- [ ] pending"].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html.match(/type="checkbox"/g)?.length).toBe(2);
  });

  it("renders strikethrough", async () => {
    const { html } = await renderMarkdown("~~gone~~", options);
    expect(html).toContain("<del>gone</del>");
  });

  it("autolinks bare URLs", async () => {
    const { html } = await renderMarkdown("See https://example.com/docs for details.", options);
    expect(html).toContain('href="https://example.com/docs"');
  });

  it("renders footnotes with working anchors", async () => {
    const source = "Text with a note.[^1]\n\n[^1]: The note body.";
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("footnotes");
    // The id and the href must reference each other, or the link is dead.
    const idMatch = /id="([^"]*fn-1[^"]*)"/.exec(html);
    expect(idMatch).not.toBeNull();
    expect(html).toContain(`href="#${idMatch![1]}"`);
  });

  it("combines several GFM constructs in one document", async () => {
    const source = [
      "## Release checklist",
      "",
      "- [x] Parser",
      "- [ ] Linux package",
      "",
      "| Platform | Status |",
      "|---|---|",
      "| Windows | Ready |",
      "",
      "See ~~old~~ https://example.com",
    ].join("\n");
    const { html } = await renderMarkdown(source, options);

    expect(html).toContain("<h2");
    expect(html).toContain("checkbox");
    expect(html).toContain("<table");
    expect(html).toContain("<del>old</del>");
    expect(html).toContain("example.com");
  });
});

describe("outline extraction", () => {
  it("builds a nested tree with source lines", async () => {
    const source = [
      "# Project",
      "",
      "## Architecture",
      "",
      "### Backend",
      "### Frontend",
      "",
      "## Installation",
    ].join("\n");
    const { outline } = await renderMarkdown(source, options);

    expect(outline).toHaveLength(1);
    const project = outline[0]!;
    expect(project.text).toBe("Project");
    expect(project.level).toBe(1);
    expect(project.line).toBe(1);
    expect(project.children.map((item) => item.text)).toEqual(["Architecture", "Installation"]);

    const architecture = project.children[0]!;
    expect(architecture.children.map((item) => item.text)).toEqual(["Backend", "Frontend"]);
  });

  it("gives every heading a stable id", async () => {
    const { html, outline } = await renderMarkdown("## Hello World", options);
    expect(outline[0]!.id).toBe("hello-world");
    expect(html).toContain('id="hello-world"');
  });
});

describe("robustness", () => {
  it("survives malformed Markdown without throwing", async () => {
    const source = ["# Unclosed [link", "```", "unterminated fence", "| broken | table", "*emphasis"].join(
      "\n",
    );
    const result = await renderMarkdown(source, options);
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.html).not.toContain("md-render-error");
  });

  it("renders an empty document as empty output", async () => {
    const { html, outline } = await renderMarkdown("", options);
    expect(outline).toEqual([]);
    expect(html.trim()).toBe("");
  });

  it("keeps a stray HTML tag from breaking following content", async () => {
    const { html } = await renderMarkdown("before <div>after", options);
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});
