/**
 * Security tests for the render pipeline.
 *
 * A Markdown file is untrusted input, so these are the tests that matter most:
 * they assert that no vector from a document reaches the preview as executable
 * markup, and that the raw-HTML switch changes nothing about that.
 */

import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/markdown/renderer/pipeline";

const WITH_RAW_HTML = { allowRawHtml: true, renderMath: true } as const;
const WITHOUT_RAW_HTML = { allowRawHtml: false, renderMath: true } as const;

describe("script execution is impossible", () => {
  it("strips a script element", async () => {
    const { html } = await renderMarkdown("<script>alert('xss')</script>", WITH_RAW_HTML);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert(");
  });

  it("strips a script element written as Markdown inline HTML", async () => {
    const source = 'Text with <script src="https://evil.example/x.js"></script> inside.';
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("evil.example");
  });

  it("strips event handler attributes", async () => {
    const source = [
      '<img src="x.png" onerror="alert(1)">',
      '<div onclick="alert(2)">click</div>',
      '<a href="#x" onmouseover="alert(3)">hover</a>',
      '<body onload="alert(4)">',
    ].join("\n\n");
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toContain("alert(");
  });

  it("drops javascript: targets from links and images", async () => {
    const source = [
      "[click](javascript:alert(1))",
      "![img](javascript:alert(2))",
      "[vbscript](vbscript:msgbox(1))",
      "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    ].join("\n\n");
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("vbscript:");
    expect(html).not.toContain("data:text/html");
  });

  it("strips style elements and style attributes", async () => {
    const source = [
      '<style>body { background: url("https://evil.example/leak") }</style>',
      '<p style="position:fixed;inset:0">overlay</p>',
    ].join("\n\n");
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toContain("evil.example");
  });

  it("strips frames, objects, embeds and forms", async () => {
    const source = [
      '<iframe src="https://evil.example"></iframe>',
      '<object data="https://evil.example/x.swf"></object>',
      '<embed src="https://evil.example/x.swf">',
      '<form action="https://evil.example"><input name="a"><button>go</button></form>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<base href="https://evil.example">',
    ].join("\n\n");
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    for (const tag of ["<iframe", "<object", "<embed", "<form", "<meta", "<base"]) {
      expect(html.toLowerCase()).not.toContain(tag);
    }
    expect(html).not.toContain("evil.example");
  });

  it("does not introduce an srcdoc attribute", async () => {
    const { html } = await renderMarkdown(
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      WITH_RAW_HTML,
    );
    expect(html).not.toContain("srcdoc");
  });
});

describe("the raw HTML switch", () => {
  it("drops HTML entirely when disabled", async () => {
    const source = "Before\n\n<details><summary>More</summary>Body</details>\n\nAfter";
    const { html } = await renderMarkdown(source, WITHOUT_RAW_HTML);

    expect(html).not.toContain("<details");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("keeps harmless HTML when enabled", async () => {
    const source = "<details>\n<summary>More</summary>\n\nBody\n\n</details>";
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    expect(html).toContain("<details>");
    expect(html).toContain("<summary>More</summary>");
  });

  it("keeps a sanitised image but not its handler", async () => {
    const { html } = await renderMarkdown('<img src="photo.png" alt="p" onerror="alert(1)">', WITH_RAW_HTML);

    expect(html).toContain("<img");
    expect(html).toContain("photo.png");
    expect(html).not.toMatch(/onerror/i);
  });
});

describe("diagram and math payloads stay inert", () => {
  it("does not inline a script from a mermaid block", async () => {
    const source = ["```mermaid", "flowchart LR", '  A["<script>alert(1)</script>"] --> B', "```"].join("\n");
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    // The source is stored as escaped text for the client renderer to read
    // back; it must not appear as live markup.
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("flowchart LR");
  });

  it("does not turn a KaTeX \\href into a real link", async () => {
    const source = "$\\href{javascript:alert(1)}{click}$";
    const { html } = await renderMarkdown(source, WITH_RAW_HTML);

    // With `trust: false` KaTeX refuses the command and prints the source as
    // inert text, so the payload can never become an attribute.
    expect(html).not.toMatch(/href\s*=\s*["']?javascript/i);
    expect(html).not.toContain("<a ");
    expect(html).toContain("katex");
  });
});
