/**
 * Content sniffing only ever runs for files whose extension said nothing, and
 * it must stay conservative: a log line that contains a brace is not JSON.
 */

import { describe, expect, it } from "vitest";

import { suggestKindFromContent } from "@/documents/detect";

describe("content sniffing", () => {
  it("recognises JSON objects and arrays", () => {
    expect(suggestKindFromContent('{\n  "a": 1\n}')).toBe("json");
    expect(suggestKindFromContent("[1, 2, 3]")).toBe("json");
  });

  it("recognises XML with a declaration and without one", () => {
    expect(suggestKindFromContent('<?xml version="1.0"?><root/>')).toBe("xml");
    expect(suggestKindFromContent("<root><item>1</item></root>")).toBe("xml");
  });

  it("recognises NDJSON-looking lines as log", () => {
    expect(suggestKindFromContent('{"level":"info","msg":"a"}\n{"level":"warn","msg":"b"}')).toBe("log");
  });

  it("recognises timestamped logs even when they mention JSON", () => {
    const log = ["2026-01-01 10:00:00 INFO  startup", '2026-01-01 10:00:01 INFO  payload {"a":1}'].join("\n");
    expect(suggestKindFromContent(log)).toBe("log");
  });

  it("recognises a consistent delimited table", () => {
    expect(suggestKindFromContent("id,name\n1,alpha\n2,beta")).toBe("csv");
    expect(suggestKindFromContent("id;name\n1;alpha")).toBe("csv");
  });

  it("returns null when nothing is convincing", () => {
    expect(suggestKindFromContent("")).toBeNull();
    expect(suggestKindFromContent("just some prose about {curly braces}")).toBeNull();
    expect(suggestKindFromContent("a\nb\nc")).toBeNull();
  });
});
