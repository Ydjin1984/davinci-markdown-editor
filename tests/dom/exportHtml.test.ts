// @vitest-environment jsdom

/**
 * Self-contained HTML export.
 *
 * "Self-contained" is the whole promise of the feature, so these tests check
 * that nothing in the exported file depends on the application still being
 * installed: styles are inline, images carry their bytes, and the author's own
 * directory layout is not leaked into a file they may share.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for the Rust command that returns a file as a `data:` URL. */
const readAssetDataUrl = vi.fn(async (path: string) => `data:image/png;base64,${btoa(path)}`);

vi.mock("@/shared/ipc", () => ({
  readAssetDataUrl: (path: string) => readAssetDataUrl(path),
}));

const { buildExportHtml, exportFileName, isAssetUrl } = await import("@/preview/exportHtml");
const { setPreviewContainer } = await import("@/preview/previewApi");

const PREVIEW_HTML = `
<h1 id="title">Title</h1>
<div class="md-code" data-line="3">
  <div class="md-code-head"><span class="md-code-lang">rust</span><button class="md-code-copy">Copy</button></div>
  <pre class="shiki" style="background-color:#f6f8fa"><code><span style="color:#0550ae">fn</span> main() {}</code></pre>
</div>
<div class="md-diagram" data-line="8" data-diagram-state="ready">
  <div class="md-diagram-tools"><button data-diagram-action="fit">Fit</button></div>
  <div class="md-diagram-stage"><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg></div>
</div>
<img src="http://mdasset.localhost/%2Fproj%2Fimages%2Fa.png" data-source="../images/a.png" data-resolved="/proj/images/a.png" loading="lazy" alt="a">
<img src="https://example.com/remote.png" alt="remote">
`;

beforeEach(() => {
  readAssetDataUrl.mockClear();

  const container = document.createElement("div");
  container.className = "markdown-body";
  container.innerHTML = PREVIEW_HTML;
  document.body.appendChild(container);
  setPreviewContainer(container);

  // The export fetches the KaTeX web fonts so they can be embedded.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { status: 200 })),
  );
});

const options = { title: "notes.md", documentDir: "/proj", appearance: "light" as const };

describe("self-contained output", () => {
  it("produces a complete HTML document", async () => {
    const html = await buildExportHtml(options);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>notes.md</title>");
    expect(html).toContain('class="markdown-body markdown-body--light"');
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("inlines the markdown stylesheet", async () => {
    const html = await buildExportHtml(options);

    // A rule from the real stylesheet, not a placeholder.
    expect(html).toContain(".markdown-body");
    expect(html).toContain("blockquote");
    // And the print rules travel with it, so the file also prints correctly.
    expect(html).toContain("@page");
  });

  it("embeds images as data URLs", async () => {
    const html = await buildExportHtml(options);

    expect(readAssetDataUrl).toHaveBeenCalledWith("/proj/images/a.png");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("mdasset");
  });

  it("leaves a remote image alone", async () => {
    const html = await buildExportHtml(options);
    expect(html).toContain('src="https://example.com/remote.png"');
  });

  it("keeps the rendered diagram SVG", async () => {
    const html = await buildExportHtml(options);
    expect(html).toContain("<svg");
    expect(html).toContain('data-diagram-state="ready"');
  });

  it("keeps the syntax highlighting inline styles", async () => {
    const html = await buildExportHtml(options);
    expect(html).toContain('style="color:#0550ae"');
  });
});

describe("output hygiene", () => {
  it("removes buttons, which do nothing in a static file", async () => {
    const html = await buildExportHtml(options);

    expect(html).not.toContain("<button");
    expect(html).not.toContain("Copy</span>");
  });

  it("does not leak the author's absolute paths", async () => {
    const html = await buildExportHtml(options);

    // `data-resolved` carries the real path on disk and would travel into any
    // file the user shares.
    expect(html).not.toContain("data-resolved");
    expect(html).not.toContain("data-source");
    expect(html).not.toContain("/proj/images/a.png");
  });

  it("does not leak the resolved path of an image that failed to load", async () => {
    const container = document.createElement("div");
    container.className = "markdown-body";
    container.innerHTML = `
      <span class="md-image-error" title="broken.png&#10;/home/author/private/broken.png">
        <strong class="md-image-error-title">Image not found</strong>
        <span class="md-image-error-path">../broken.png</span>
        <span class="md-image-error-hint">No file exists at this path.</span>
      </span>`;
    document.body.appendChild(container);
    setPreviewContainer(container);

    const html = await buildExportHtml(options);

    expect(html).not.toContain("/home/author/private");
    // The reference the author wrote is still there.
    expect(html).toContain("../broken.png");
  });

  it("drops the scroll-sync markers", async () => {
    const html = await buildExportHtml(options);
    expect(html).not.toContain("data-line");
  });

  it("drops lazy loading, since the bytes are already inline", async () => {
    const html = await buildExportHtml(options);
    expect(html).not.toContain('loading="lazy"');
  });
});

describe("robustness", () => {
  it("falls back to the original reference when an asset cannot be read", async () => {
    readAssetDataUrl.mockRejectedValueOnce(new Error("outside the allowed folders"));

    const html = await buildExportHtml(options);

    // The file still exports, naming the image rather than failing outright.
    expect(html).toContain("../images/a.png");
    expect(html).toContain("</html>");
  });

  it("still produces a document when there is no preview", async () => {
    setPreviewContainer(null);

    const html = await buildExportHtml(options);

    expect(html).toContain("Nothing to export");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });
});

describe("helpers", () => {
  it("suggests a file name from the document title", () => {
    expect(exportFileName("architecture.md", "html")).toBe("architecture.html");
    expect(exportFileName("Мои заметки.md", "pdf")).toBe("Мои заметки.pdf");
  });

  it("recognises asset URLs in both platform forms", () => {
    expect(isAssetUrl("http://mdasset.localhost/x")).toBe(true);
    expect(isAssetUrl("mdasset://localhost/x")).toBe(true);
    expect(isAssetUrl("https://example.com/x")).toBe(false);
  });
});
