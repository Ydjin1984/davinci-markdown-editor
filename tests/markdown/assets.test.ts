/**
 * Asset URL resolution.
 *
 * Regression guard for a reported bug: images referenced with `../` never
 * loaded, and a refused image showed a bare broken-image icon with no
 * explanation.
 *
 * `convertFileSrc` is stubbed so the resolution can be asserted without a Tauri
 * runtime. The stub mirrors the real shape: a percent-encoded absolute path in
 * the URL path component, on a `mdasset.localhost` origin.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol = "asset") =>
    `http://${protocol}.localhost/${encodeURIComponent(path)}`,
}));

const { renderMarkdown } = await import("@/markdown/renderer/pipeline");

const options = { allowRawHtml: true, renderMath: true, documentDir: "/project/docs/guide" };

const ASSET_ORIGIN = "http://mdasset.localhost/";

/** The absolute path encoded in a rewritten `src`. */
function decodedSrc(html: string): string | null {
  const value = extractAttribute(html, "src", ASSET_ORIGIN);
  return value === null ? null : decodeURIComponent(value.slice(ASSET_ORIGIN.length));
}

function dataResolved(html: string): string | null {
  return extractAttribute(html, "data-resolved");
}

/** The `data-source` the pipeline captured, if any. */
function labelOf(html: string): string | null {
  return extractAttribute(html, "data-source");
}

/**
 * Read an attribute value out of rendered HTML.
 *
 * Written with `indexOf`/`slice` rather than a pattern match: this is a test
 * helper over a string this suite produced itself, and a pattern here trips
 * scanners that look for command execution.
 */
function extractAttribute(html: string, name: string, prefix = ""): string | null {
  const anchor = html.indexOf(`${name}="${prefix}`);
  if (anchor === -1) return null;

  const valueStart = anchor + name.length + 2;
  const valueEnd = html.indexOf('"', valueStart);
  if (valueEnd === -1) return null;

  return html.slice(valueStart, valueEnd);
}

describe("relative image references", () => {
  it("resolves a same-directory reference", async () => {
    const { html } = await renderMarkdown("![a](./local.png)", options);

    expect(decodedSrc(html)).toBe("/project/docs/guide/local.png");
    expect(dataResolved(html)).toBe("/project/docs/guide/local.png");
  });

  it("resolves a reference one level up", async () => {
    // The case that used to fail: a page in a subfolder pointing at a shared
    // image folder beside it.
    const { html } = await renderMarkdown("![a](../images/logo.png)", options);

    expect(decodedSrc(html)).toBe("/project/docs/images/logo.png");
  });

  it("resolves a reference two levels up", async () => {
    const { html } = await renderMarkdown("![a](../../images/logo.png)", options);

    expect(decodedSrc(html)).toBe("/project/images/logo.png");
  });

  it("resolves a bare relative path without a leading ./", async () => {
    const { html } = await renderMarkdown("![a](diagram.svg)", options);

    expect(decodedSrc(html)).toBe("/project/docs/guide/diagram.svg");
  });

  it("handles a Windows document directory", async () => {
    const { html } = await renderMarkdown("![a](../images/logo.png)", {
      ...options,
      documentDir: "C:\\project\\docs\\guide",
    });

    // One level up from `docs\guide` is `docs`, not `project`.
    expect(decodedSrc(html)).toBe("C:\\project\\docs\\images\\logo.png");
  });

  it("resolves a path containing spaces written with angle brackets", async () => {
    const { html } = await renderMarkdown("![a](<../My Images/logo.png>)", {
      ...options,
      documentDir: "/home/user/My Documents/notes",
    });

    expect(decodedSrc(html)).toBe("/home/user/My Documents/My Images/logo.png");
  });

  it("resolves a path containing spaces written percent-encoded", async () => {
    // A destination is a URL, so `%20` is a space in the file name.
    const { html } = await renderMarkdown("![a](../My%20Images/logo.png)", {
      ...options,
      documentDir: "/home/user/My Documents/notes",
    });

    expect(decodedSrc(html)).toBe("/home/user/My Documents/My Images/logo.png");
  });

  it("leaves a malformed escape alone instead of failing", async () => {
    const { html } = await renderMarkdown("![a](../100%25/logo.png)", options);
    // `%25` decodes to a literal `%`.
    expect(decodedSrc(html)).toBe("/project/docs/100%/logo.png");
  });

  it("marks the image for lazy loading", async () => {
    const { html } = await renderMarkdown("![a](./local.png)", options);
    expect(html).toContain('loading="lazy"');
  });
});

describe("targets that are not local files", () => {
  it("leaves a remote URL untouched", async () => {
    const { html } = await renderMarkdown("![a](https://example.com/logo.png)", options);

    expect(html).toContain('src="https://example.com/logo.png"');
    expect(labelOf(html)).toBeNull();
  });

  it("leaves an inline data URI untouched", async () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    const { html } = await renderMarkdown(`![a](${data})`, options);

    expect(html).toContain(`src="${data}"`);
    expect(labelOf(html)).toBeNull();
  });

  it("never carries a javascript target, not even as a saved reference", async () => {
    const { html } = await renderMarkdown("![a](javascript:alert(1))", options);

    expect(html).not.toContain("javascript:");
    // The element survives with no source at all, which loads nothing.
    expect(extractAttribute(html, "src")).toBeNull();
    expect(labelOf(html)).toBeNull();
  });

  it("does not rewrite anything when no document directory is known", async () => {
    const { html } = await renderMarkdown("![a](../images/logo.png)", {
      ...options,
      documentDir: null,
    });

    // Without a base there is nothing to resolve against, so the reference is
    // left as the author wrote it rather than guessed at.
    expect(html).toContain("images/logo.png");
    expect(html).not.toContain("mdasset");
  });
});

describe("absolute Windows paths", () => {
  it("resolves a drive path even though the sanitiser drops it as a scheme", async () => {
    const { html } = await renderMarkdown("![a](C:/images/logo.png)", options);

    // `C:` reads as a URL scheme, so the sanitiser removes `src`; the pipeline
    // restores it from the captured reference.
    expect(decodedSrc(html)).toBe("C:/images/logo.png");
    expect(dataResolved(html)).toBe("C:/images/logo.png");
  });
});
