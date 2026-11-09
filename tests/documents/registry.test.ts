/**
 * The registry is the single answer to "what is this file", so its edge cases
 * are worth pinning down: case-insensitive extensions, Markdown aliases,
 * unknown files degrading to text, and a filter for every kind.
 */

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_TYPES,
  descriptorFor,
  descriptorForExtension,
  extensionsFor,
  isMarkdownPath,
  isStructuredPath,
  isSupportedDocumentPath,
  kindFromPath,
  supportedExtensions,
} from "@/documents/registry";

describe("document registry", () => {
  it("detects every declared extension in any case", () => {
    expect(kindFromPath("notes.md")).toBe("markdown");
    expect(kindFromPath("NOTES.MD")).toBe("markdown");
    expect(kindFromPath("README.markdown")).toBe("markdown");
    expect(kindFromPath("config.json")).toBe("json");
    expect(kindFromPath("CONFIG.JSON")).toBe("json");
    expect(kindFromPath("telemetry.csv")).toBe("csv");
    expect(kindFromPath("application.log")).toBe("log");
    expect(kindFromPath("calibration.xml")).toBe("xml");
    expect(kindFromPath("notes.txt")).toBe("text");
  });

  it("keeps Markdown aliases working", () => {
    for (const extension of ["md", "markdown", "mdown", "mkdn", "mkd", "mdx", "mdtxt", "mdtext"]) {
      expect(isMarkdownPath(`file.${extension}`)).toBe(true);
    }
    expect(isMarkdownPath("file.json")).toBe(false);
  });

  it("treats unknown extensions as plain text rather than failing", () => {
    expect(kindFromPath("archive.bin")).toBe("text");
    expect(kindFromPath("no-extension")).toBe("text");
    expect(isSupportedDocumentPath("archive.bin")).toBe(false);
    expect(isSupportedDocumentPath("notes.unknown")).toBe(false);
  });

  it("marks only non-Markdown, non-text formats as structured", () => {
    expect(isStructuredPath("a.json")).toBe(true);
    expect(isStructuredPath("a.csv")).toBe(true);
    expect(isStructuredPath("a.log")).toBe(true);
    expect(isStructuredPath("a.xml")).toBe(true);
    expect(isStructuredPath("a.md")).toBe(false);
    expect(isStructuredPath("a.txt")).toBe(false);
  });

  it("answers descriptor questions consistently", () => {
    for (const descriptor of DOCUMENT_TYPES) {
      expect(descriptorFor(descriptor.kind)).toBe(descriptor);
      expect(descriptorForExtension(descriptor.extensions[0]!)).toBe(descriptor);
      expect(extensionsFor(descriptor.kind).length).toBeGreaterThan(0);
      expect(descriptor.modes.length).toBeGreaterThan(0);
      expect(descriptor.modes).toContain(descriptor.defaultMode);
    }
    expect(descriptorForExtension("nope")).toBeNull();
    expect(descriptorFor("text").kind).toBe("text");
  });

  it("exposes each claimed extension exactly once", () => {
    const extensions = supportedExtensions();
    expect(new Set(extensions).size).toBe(extensions.length);
    expect(extensions).toContain("md");
    expect(extensions).toContain("json");
    expect(extensions).toContain("csv");
    expect(extensions).toContain("log");
    expect(extensions).toContain("xml");
  });
});
