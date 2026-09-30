/** Utility helpers used across the UI. */

import { describe, expect, it } from "vitest";

import {
  basename,
  clamp,
  countWords,
  cx,
  debounce,
  dirname,
  escapeHtml,
  extensionOf,
  formatBytes,
  isImageTarget,
  isMarkdownPath,
  lineAtOffset,
  resolveLinkTarget,
  stem,
} from "@/shared/util";

describe("path helpers", () => {
  it("handles both separators", () => {
    expect(basename("/home/u/docs/api.md")).toBe("api.md");
    expect(basename("C:\\Docs\\architecture.md")).toBe("architecture.md");
    expect(basename("/home/u/docs/")).toBe("docs");
  });

  it("keeps Unicode and spaces intact", () => {
    expect(basename("/home/u/Мои документы/архитектура.md")).toBe("архитектура.md");
    expect(basename("C:\\Мои документы\\заметки.md")).toBe("заметки.md");
  });

  it("derives the directory", () => {
    expect(dirname("/home/u/docs/api.md")).toBe("/home/u/docs");
    expect(dirname("C:\\Docs\\a.md")).toBe("C:\\Docs");
  });

  it("detects Markdown extensions case-insensitively", () => {
    expect(isMarkdownPath("README.MD")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
    expect(isMarkdownPath("notes.txt")).toBe(false);
    expect(extensionOf("a.b.c.md")).toBe("md");
  });

  it("computes a name without its extension", () => {
    expect(stem("/docs/architecture.md")).toBe("architecture");
    expect(stem("/docs/README")).toBe("README");
  });
});

describe("resolveLinkTarget", () => {
  it("resolves sibling paths against the document directory", () => {
    expect(resolveLinkTarget("images/a.png", "/docs")).toBe("/docs/images/a.png");
    expect(resolveLinkTarget("./images/a.png", "/docs")).toBe("/docs/images/a.png");
  });

  it("walks parent segments", () => {
    expect(resolveLinkTarget("../images/a.png", "/home/u/docs")).toBe("/home/u/images/a.png");
    expect(resolveLinkTarget("../../a.png", "/home/u/docs")).toBe("/home/a.png");
  });

  it("keeps Windows-style document directories", () => {
    expect(resolveLinkTarget("images/a.png", "C:\\Docs")).toBe("C:\\Docs\\images\\a.png");
  });

  it("leaves absolute targets alone", () => {
    expect(resolveLinkTarget("https://example.com/a.png", "/docs")).toBe("https://example.com/a.png");
    expect(resolveLinkTarget("/var/a.png", "/docs")).toBe("/var/a.png");
  });

  it("returns the input when there is no document directory", () => {
    expect(resolveLinkTarget("a.png", null)).toBe("a.png");
  });
});

describe("isImageTarget", () => {
  it("recognises inlineable images", () => {
    for (const name of ["a.png", "a.JPG", "a.jpeg", "a.gif", "a.webp", "a.svg", "a.avif"]) {
      expect(isImageTarget(name)).toBe(true);
    }
  });

  it("ignores query strings and fragments", () => {
    expect(isImageTarget("a.png?raw=1")).toBe(true);
    expect(isImageTarget("a.png#frag")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isImageTarget("a.md")).toBe(false);
    expect(isImageTarget(".env")).toBe(false);
    expect(isImageTarget("id_rsa")).toBe(false);
  });
});

describe("text helpers", () => {
  it("counts words the way a status bar does", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("line one\nline two")).toBe(4);
  });

  it("escapes HTML for export", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("computes a line number from an offset", () => {
    const text = "one\ntwo\nthree";
    expect(lineAtOffset(text, 0)).toBe(1);
    expect(lineAtOffset(text, 4)).toBe(2);
    expect(lineAtOffset(text, 8)).toBe(3);
    expect(lineAtOffset(text, 999)).toBe(3);
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("joins class names", () => {
    expect(cx("a", false, undefined, "b")).toBe("a b");
  });

  it("clamps to a range", () => {
    expect(clamp(0.05, 0.15, 0.85)).toBe(0.15);
    expect(clamp(2, 0.15, 0.85)).toBe(0.85);
    expect(clamp(0.5, 0.15, 0.85)).toBe(0.5);
  });
});

describe("debounce", () => {
  it("collapses a burst into one call with the latest arguments", async () => {
    const calls: number[] = [];
    const debounced = debounce((value: number) => calls.push(value), 10);

    debounced(1);
    debounced(2);
    debounced(3);
    expect(calls).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([3]);
  });

  it("can be cancelled", async () => {
    const calls: number[] = [];
    const debounced = debounce((value: number) => calls.push(value), 10);

    debounced(1);
    debounced.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
  });
});
