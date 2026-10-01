/**
 * Front matter handling.
 *
 * CommonMark has no concept of a metadata block, so without this the closing
 * delimiter is read as a setext heading underline and the whole block renders
 * as one enormous heading — which is exactly what a skill or a Jekyll page
 * looks like otherwise.
 */

import { describe, expect, it } from "vitest";

import { parseFrontMatter } from "@/markdown/frontmatter";
import { renderMarkdown } from "@/markdown/renderer/pipeline";

const options = { allowRawHtml: true, renderMath: true } as const;

const SKILL_LIKE = [
  "---",
  "name: markdown-diagrams",
  "description: Обязательный стиль документов",
  "---",
  "",
  "# Markdown со схемами",
  "",
  "Цель: любой сохранённый файл — самодостаточный документ.",
].join("\n");

describe("parsing", () => {
  it("splits a YAML block from the document", () => {
    const front = parseFrontMatter(SKILL_LIKE);

    expect(front).not.toBeNull();
    expect(front!.delimiter).toBe("---");
    expect(front!.entries).toEqual([
      { key: "name", value: "markdown-diagrams" },
      { key: "description", value: "Обязательный стиль документов" },
    ]);
    expect(front!.rest.startsWith("\n# Markdown со схемами")).toBe(true);
  });

  it("recognises TOML front matter as well", () => {
    const front = parseFrontMatter('+++\ntitle = "Notes"\n+++\n\n# Title\n');
    expect(front?.delimiter).toBe("+++");
    expect(front?.entries).toEqual([{ key: "title", value: '"Notes"' }]);
  });

  it("preserves the line count so positions stay aligned", () => {
    const front = parseFrontMatter(SKILL_LIKE)!;

    // Replacing the block with blank lines must not shift anything below it:
    // the padded document has exactly as many lines as the original, and the
    // heading is still on the line it was written on.
    const padded = front.padding + front.rest;
    expect(padded.split("\n").length).toBe(SKILL_LIKE.split("\n").length);
    // The heading sits on line 6 of the original file, and on line 6 here.
    expect(padded.split("\n")[5]).toBe("# Markdown со схемами");
  });

  it("ignores a document without front matter", () => {
    expect(parseFrontMatter("# Just a heading\n\nText.")).toBeNull();
  });

  it("ignores a thematic break further down the document", () => {
    const source = "# Heading\n\nText.\n\n---\n\nMore text.\n";
    expect(parseFrontMatter(source)).toBeNull();
  });

  it("requires the closing delimiter", () => {
    expect(parseFrontMatter("---\nname: x\n\n# Body\n")).toBeNull();
  });

  it("tolerates a document that is only front matter", () => {
    const front = parseFrontMatter("---\nname: x\n---");
    expect(front?.entries).toEqual([{ key: "name", value: "x" }]);
    expect(front?.rest).toBe("");
  });

  it("joins indented continuation lines", () => {
    const front = parseFrontMatter("---\ntitle: A very\n  long title\ntags: a, b\n---\n");
    expect(front?.entries).toEqual([
      { key: "title", value: "A very long title" },
      { key: "tags", value: "a, b" },
    ]);
  });

  it("reads a block scalar", () => {
    const front = parseFrontMatter("---\ndescription: |\n  Первая строка\n  вторая строка\n---\n");
    expect(front?.entries?.[0]?.value).toBe("Первая строка\nвторая строка");
  });

  it("falls back to raw text when the block is not a flat mapping", () => {
    const nested = "---\nnested:\n  key: value\nauthors:\n  - one\n  - two\n---\n";
    const front = parseFrontMatter(nested);
    // `- one` is not a `key: value` line, so the block is shown verbatim
    // rather than half-parsed into something wrong.
    expect(front?.entries).toBeNull();
    expect(front?.raw).toContain("authors:");
  });

  it("handles a block that opens with a byte order mark", () => {
    const front = parseFrontMatter("\uFEFF---\nname: x\n---\n\n# Body\n");
    expect(front?.entries).toEqual([{ key: "name", value: "x" }]);
  });

  it("handles CRLF line endings", () => {
    const front = parseFrontMatter("---\r\nname: x\r\n---\r\n\r\n# Body\r\n");
    expect(front?.entries).toEqual([{ key: "name", value: "x" }]);
    expect(front?.rest.trimStart().startsWith("# Body")).toBe(true);
  });
});

describe("rendering", () => {
  it("shows the block as a card instead of a heading", async () => {
    const { html } = await renderMarkdown(SKILL_LIKE, options);

    expect(html).toContain('class="md-frontmatter"');
    expect(html).toContain("markdown-diagrams");
    // The tell-tale symptom: the whole block becoming a heading.
    expect(html).not.toMatch(/<h[12][^>]*>\s*name:/);
  });

  it("still renders the document body", async () => {
    const { html } = await renderMarkdown(SKILL_LIKE, options);

    expect(html).toContain(">Markdown со схемами</h1>");
    expect(html).toContain("самодостаточный документ");
  });

  it("keeps source line numbers aligned with the original file", async () => {
    const source = ["---", "name: x", "---", "", "Paragraph.", "", "> Quote"].join("\n");
    const { html } = await renderMarkdown(source, options);

    // `Paragraph.` is on line 5 of the file and `> Quote` on line 7.
    expect(html).toContain('data-line="5"');
    expect(html).toContain('data-line="7"');
  });

  it("does not leak the metadata into the outline", async () => {
    const { outline } = await renderMarkdown(SKILL_LIKE, options);

    expect(outline.map((item) => item.text)).toEqual(["Markdown со схемами"]);
  });

  it("escapes metadata values", async () => {
    const hostile = "---\ntitle: <script>alert(1)</script>\n---\n\n# Body\n";
    const { html } = await renderMarkdown(hostile, options);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("leaves a document without front matter untouched", async () => {
    const { html } = await renderMarkdown("# Title\n\nText.", options);

    expect(html).not.toContain("md-frontmatter");
    expect(html).toContain(">Title</h1>");
  });
});
