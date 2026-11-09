// @vitest-environment jsdom

/**
 * JSON module: lossless parser, formatter, JSON Pointer, outline and edges.
 *
 * The parser is the contract here — the viewer is built on it — so these tests
 * pin exact lexemes, key order, duplicates, escapes and diagnostic positions.
 * The last suite renders the viewer in jsdom to check the tree, the fallback
 * for invalid input and the explicit format/minify commands.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerProps } from "@/documents/types";
import { JsonViewer, HEAVY_CONTENT_LIMIT, shouldDeferBuild } from "@/formats/json/JsonViewer";
import { jsonModule, parseJson as parseJsonFromModule } from "@/formats/json";
import { MAX_OUTLINE_ITEMS, jsonOutline } from "@/formats/json/outline";
import {
  buildLineIndex,
  formatJson,
  lineColumnAt,
  MAX_DEPTH,
  MAX_NODES,
  minifyJson,
  minifyNode,
  parseJson,
} from "@/formats/json/parse";
import type { JsonNode, JsonObjectNode, JsonRoot } from "@/formats/json/parse";
import { escapePointerSegment, jsonPointer } from "@/formats/json/pointer";

// --- fixtures (copies of DaVinci_Render_Kit/examples) ----------------------

/** `examples/config.json`: 6 keys, exact integer, Cyrillic, null. */
const CONFIG_EXAMPLE = [
  "{",
  '  "project": "DaVinci",',
  '  "enabled": true,',
  '  "serial": "000123",',
  '  "preciseInteger": 9007199254740993,',
  '  "channels": [',
  "    {",
  '      "name": "RPM",',
  '      "unit": "rpm"',
  "    },",
  "    {",
  '      "name": "Температура",',
  '      "unit": "°C"',
  "    }",
  "  ],",
  '  "note": null',
  "}",
  "",
].join("\n");

/** `examples/duplicate.json`: the same key twice, both values kept. */
const DUPLICATE_EXAMPLE = '{"mode":"first","mode":"second"}';

/** `examples/invalid.json`: a trailing comma before the closing brace. */
const INVALID_EXAMPLE = '{\n  "enabled": true,\n}\n';

const KIT_EXAMPLES = join(process.cwd(), "..", "DaVinci_Render_Kit", "examples");
const HAS_KIT = existsSync(join(KIT_EXAMPLES, "config.json"));

// --- helpers ---------------------------------------------------------------

/** Model or a loud failure, so tests never silently pass on a null model. */
function modelOf(source: string): JsonRoot {
  const result = parseJson(source);
  if (result.model === null) {
    throw new Error(`expected valid JSON, got: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.model;
}

function objectOf(node: JsonNode): JsonObjectNode {
  if (node.kind !== "object") throw new Error(`expected an object, got ${node.kind}`);
  return node;
}

/** Comparable form: strings become objects so `"1"` never equals `1`. */
function plain(node: JsonNode): unknown {
  switch (node.kind) {
    case "string":
      return { string: node.value };
    case "number":
      return { number: node.raw };
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "truncated":
      return { truncated: true };
    case "array":
      return node.items.map(plain);
    case "object":
      return node.entries.map((entry) => [entry.key, plain(entry.value)] as const);
  }
}

function firstError(source: string) {
  const result = parseJson(source);
  const error = result.diagnostics.find((item) => item.severity === "error");
  if (!error) throw new Error(`expected an error diagnostic for: ${source}`);
  return { result, error };
}

// --- valid documents ------------------------------------------------------

describe("parseJson — valid documents", () => {
  it("parses examples/config.json exactly", () => {
    const model = modelOf(CONFIG_EXAMPLE);
    const root = objectOf(model.node);

    expect(root.entries.map((entry) => entry.key)).toEqual([
      "project",
      "enabled",
      "serial",
      "preciseInteger",
      "channels",
      "note",
    ]);

    const byKey = new Map(root.entries.map((entry) => [entry.key, entry.value]));
    expect(byKey.get("project")).toMatchObject({ kind: "string", value: "DaVinci" });
    expect(byKey.get("enabled")).toMatchObject({ kind: "boolean", value: true });
    expect(byKey.get("note")).toMatchObject({ kind: "null", raw: "null" });
    expect(byKey.get("serial")).toMatchObject({ kind: "string", value: "000123" });

    const channels = byKey.get("channels");
    if (!channels || channels.kind !== "array") throw new Error("channels must be an array");
    expect(channels.items).toHaveLength(2);
    expect(plain(channels.items[0] as JsonNode)).toEqual([
      ["name", { string: "RPM" }],
      ["unit", { string: "rpm" }],
    ]);
    expect(plain(channels.items[1] as JsonNode)).toEqual([
      ["name", { string: "Температура" }],
      ["unit", { string: "°C" }],
    ]);
    expect(model.truncated).toBe(false);
    expect(parseJson(CONFIG_EXAMPLE).diagnostics).toEqual([]);
  });

  it("accepts every JSON value as a document root", () => {
    expect(modelOf("42").node).toMatchObject({ kind: "number", raw: "42" });
    expect(modelOf("-0").node).toMatchObject({ kind: "number", raw: "-0" });
    expect(modelOf("1.5e+10").node).toMatchObject({ kind: "number", raw: "1.5e+10" });
    expect(modelOf('"hi"').node).toMatchObject({ kind: "string", value: "hi" });
    expect(modelOf("true").node).toMatchObject({ kind: "boolean", value: true });
    expect(modelOf("false").node).toMatchObject({ kind: "boolean", value: false });
    expect(modelOf("null").node).toMatchObject({ kind: "null" });
    expect(modelOf("[]").node).toMatchObject({ kind: "array" });
    expect(modelOf("{}").node).toMatchObject({ kind: "object" });
  });

  it("accepts surrounding JSON whitespace and a leading BOM", () => {
    expect(modelOf(' \t\r\n{"a": 1} \n\t ').node.kind).toBe("object");
    expect(modelOf('\uFEFF{"a": 1}').node.kind).toBe("object");
    expect(modelOf("\uFEFF[1]").node.kind).toBe("array");
  });

  it("keeps empty containers without inventing entries", () => {
    const object = objectOf(modelOf("{}").node);
    expect(object.entries).toHaveLength(0);
    const array = modelOf("[]").node;
    expect(array.kind).toBe("array");
    if (array.kind === "array") expect(array.items).toHaveLength(0);
  });

  it("accepts raw Unicode text, including a surrogate pair", () => {
    expect(modelOf('"Привет, мир"').node).toMatchObject({ kind: "string", value: "Привет, мир" });
    const emoji = modelOf('"a😀b"').node;
    if (emoji.kind !== "string") throw new Error("expected string");
    expect(emoji.value).toBe("a😀b");
    expect(emoji.value.length).toBe(4);
  });

  it("does not fail on repeated calls with different documents", () => {
    expect(parseJson('{"a":').model).toBeNull();
    const valid = parseJson(CONFIG_EXAMPLE);
    expect(valid.model).not.toBeNull();
    expect(valid.diagnostics).toHaveLength(0);
    expect(parseJson("[1,2,]").model).toBeNull();
    const again = parseJson(CONFIG_EXAMPLE);
    expect(again.model).not.toBeNull();
    expect(plain(again.model?.node as JsonNode)).toEqual(plain(valid.model?.node as JsonNode));
  });
});

// --- numbers ---------------------------------------------------------------

describe("parseJson — exact number lexemes", () => {
  it("keeps 9007199254740993 without rounding", () => {
    const source = '{"preciseInteger": 9007199254740993}';
    const entry = objectOf(modelOf(source).node).entries[0];
    if (!entry || entry.value.kind !== "number") throw new Error("expected a number");
    expect(entry.value.raw).toBe("9007199254740993");

    // The lossy shortcut this module exists to avoid: JS rounds the lexeme.
    expect(String(Number(entry.value.raw))).toBe("9007199254740992");
    expect(minifyJson(modelOf(source))).toBe('{"preciseInteger":9007199254740993}');
  });

  it("preserves exponent and fraction spelling", () => {
    const source = '{"a":1E+2,"b":1e-2,"c":-0.50,"d":0.000,"e":1e10}';
    const entries = objectOf(modelOf(source).node).entries;
    expect(entries.map((entry) => (entry.value.kind === "number" ? entry.value.raw : null))).toEqual([
      "1E+2",
      "1e-2",
      "-0.50",
      "0.000",
      "1e10",
    ]);
    expect(minifyJson(modelOf(source))).toBe(source);
  });

  it("rejects number spellings JSON does not allow", () => {
    for (const source of ["01", "0x10", "+1", ".5", "1.", "1e", "1e+", "--1", "00", "1..2"]) {
      const result = parseJson(source);
      expect(result.model, `expected ${source} to be rejected`).toBeNull();
      expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
    }
  });
});

// --- duplicates ------------------------------------------------------------

describe("parseJson — duplicate keys", () => {
  it("keeps both duplicate.json entries and warns once", () => {
    const result = parseJson(DUPLICATE_EXAMPLE);
    const model = result.model;
    if (model === null) throw new Error("duplicate.json must parse");
    const entries = objectOf(model.node).entries;

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.key)).toEqual(["mode", "mode"]);
    expect(entries.map((entry) => entry.duplicate)).toEqual([false, true]);
    expect(entries[0]?.value).toMatchObject({ kind: "string", value: "first" });
    expect(entries[1]?.value).toMatchObject({ kind: "string", value: "second" });

    const warnings = result.diagnostics.filter((item) => item.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("mode");
    expect(warnings[0]?.from).toBe(DUPLICATE_EXAMPLE.lastIndexOf('"mode"'));
    expect(warnings[0]?.line).toBe(1);
  });

  it("marks the third occurrence too and never merges keys", () => {
    const result = parseJson('{"a":1,"a":2,"a":3}');
    const entries = objectOf(result.model?.node as JsonNode).entries;
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.duplicate)).toEqual([false, true, true]);
    expect(result.diagnostics.filter((item) => item.severity === "warning")).toHaveLength(2);
  });

  it("formats and minifies duplicates without losing either value", () => {
    const model = modelOf(DUPLICATE_EXAMPLE);
    const minified = minifyJson(model);
    expect(minified).toBe(DUPLICATE_EXAMPLE);

    const formatted = formatJson(model);
    expect(formatted).toBe('{\n  "mode": "first",\n  "mode": "second"\n}');
    const reparsed = modelOf(formatted ?? "");
    expect(
      objectOf(reparsed.node).entries.map((entry) =>
        entry.value.kind === "string" ? entry.value.value : null,
      ),
    ).toEqual(["first", "second"]);
  });
});

// --- invalid documents -----------------------------------------------------

describe("parseJson — diagnostics for invalid JSON", () => {
  it("reports the trailing comma of examples/invalid.json at its exact position", () => {
    const { result, error } = firstError(INVALID_EXAMPLE);
    expect(result.model).toBeNull();
    expect(error.message).toMatch(/trailing comma/i);
    expect(error.from).toBe(INVALID_EXAMPLE.indexOf(","));
    expect(error.line).toBe(2);
    expect(error.column).toBe(18);
    expect(error.to).toBeGreaterThan(error.from);
  });

  it("reports a trailing comma in an array", () => {
    const { error } = firstError("[1, 2,]");
    expect(error.message).toMatch(/trailing comma/i);
    expect(error.from).toBe("[1, 2,]".indexOf(",", 3));
  });

  it("reports structural errors with a range and a 1-based position", () => {
    const cases: Array<{ source: string; message: RegExp }> = [
      { source: '{"a": 1', message: /closing '\}'/i },
      { source: "[1, 2", message: /closing '\]'/i },
      { source: '{"a" 1}', message: /expected ':'/i },
      { source: '{"a": 1 "b": 2}', message: /expected ',' or '\}'/i },
      { source: "{a: 1}", message: /double-quoted property name/i },
      { source: '"abc', message: /unterminated string/i },
      { source: '"abc\\', message: /cut off|unterminated/i },
      { source: '"\\x41"', message: /invalid escape sequence/i },
      { source: '"\\u12"', message: /four hexadecimal digits/i },
      { source: '"a\nb"', message: /unescaped control character/i },
      { source: '{"a":1} {"b":2}', message: /unexpected content/i },
      { source: "{} extra", message: /unexpected content/i },
      { source: "// note\n{}", message: /comments are not allowed/i },
      { source: "{/* note */}", message: /comments are not allowed/i },
      { source: "'a'", message: /double quotes/i },
      { source: "NaN", message: /unexpected/i },
      { source: "Infinity", message: /unexpected/i },
      { source: "undefined", message: /unexpected/i },
      { source: "", message: /empty/i },
      { source: "   \n\t ", message: /empty/i },
    ];

    for (const { source, message } of cases) {
      const result = parseJson(source);
      expect(result.model, source).toBeNull();
      const error = result.diagnostics.find((item) => item.severity === "error");
      expect(error, source).toBeDefined();
      if (!error) continue;
      expect(error.message, source).toMatch(message);
      expect(error.from, source).toBeGreaterThanOrEqual(0);
      expect(error.to, source).toBeGreaterThanOrEqual(error.from);
      expect(error.line, source).toBeGreaterThanOrEqual(1);
      expect(error.column, source).toBeGreaterThanOrEqual(1);
    }
  });

  it("counts UTF-16 offsets like CodeMirror, including surrogate pairs", () => {
    const source = '{"emoji":"😀","bad" 2}';
    const { error } = firstError(source);
    const badOffset = source.indexOf("2}");
    expect(error.from).toBe(badOffset);
    // Line 1: the emoji is two UTF-16 units, so the column includes both.
    expect(error.line).toBe(1);
    expect(error.column).toBe(badOffset + 1);
  });

  it("never throws, whatever the input", () => {
    const broken = [
      "",
      " ",
      "{",
      "}",
      "[",
      "]",
      '"',
      '"\\',
      '{"a"',
      '{"a":}',
      '{"a":1',
      "[1,",
      "[1,]",
      '{"a":1,}',
      "nul",
      "1.",
      ".5",
      "+1",
      "01",
      "{a:1}",
      "{\u0000:1}",
      "[undefined]",
      "𠮷",
    ];
    for (const source of broken) {
      expect(() => parseJson(source), source).not.toThrow();
      const result = parseJson(source);
      expect(result.diagnostics.length, source).toBeGreaterThan(0);
    }
  });
});

// --- escapes ---------------------------------------------------------------

describe("parseJson — escape sequences", () => {
  const source = '{"a":"line\\nbreak \\u041f \\"q\\" \\\\ \\/ \\b\\f\\r\\t"}';

  it("decodes every JSON escape", () => {
    const entry = objectOf(modelOf(source).node).entries[0];
    if (!entry || entry.value.kind !== "string") throw new Error("expected a string");
    expect(entry.value.value).toBe('line\nbreak П "q" \\ / \b\f\r\t');
  });

  it("keeps the escaped lexeme verbatim for round-tripping", () => {
    const model = modelOf(source);
    const entry = objectOf(model.node).entries[0];
    if (!entry || entry.value.kind !== "string") throw new Error("expected a string");
    expect(entry.value.raw).toBe('"line\\nbreak \\u041f \\"q\\" \\\\ \\/ \\b\\f\\r\\t"');
    expect(entry.rawKey).toBe('"a"');
    expect(minifyJson(model)).toBe(source);
    expect(formatJson(model)).toBe(`{\n  "a": ${entry.value.raw}\n}`);
  });

  it("decodes \\u escapes and surrogate pairs", () => {
    const cyrillic = modelOf('"\\u041f\\u0440\\u0438\\u0432\\u0435\\u0442"').node;
    expect(cyrillic).toMatchObject({ kind: "string", value: "Привет" });

    const emoji = modelOf('"\\ud83d\\ude00"').node;
    if (emoji.kind !== "string") throw new Error("expected string");
    expect(emoji.value).toBe("😀");
    expect(emoji.value.length).toBe(2);
  });

  it("rejects invalid escapes and control characters", () => {
    for (const bad of ['"\\q"', '"\\uZZZZ"', '"a\tb"', '"a\u0000b"']) {
      expect(parseJson(bad).model, bad).toBeNull();
    }
  });
});

// --- JSON Pointer ----------------------------------------------------------

describe("JSON Pointer (RFC 6901)", () => {
  it("escapes ~ and / in that order", () => {
    expect(escapePointerSegment("a/b")).toBe("a~1b");
    expect(escapePointerSegment("x~y")).toBe("x~0y");
    expect(escapePointerSegment("~/")).toBe("~0~1");
    expect(escapePointerSegment("~01")).toBe("~001");
    expect(escapePointerSegment(3)).toBe("3");
  });

  it("builds pointers from decoded keys and indices", () => {
    expect(jsonPointer([])).toBe("");
    expect(jsonPointer(["project"])).toBe("/project");
    expect(jsonPointer(["a/b", 0, "x~y"])).toBe("/a~1b/0/x~0y");
    expect(jsonPointer(["channels", 1, "unit"])).toBe("/channels/1/unit");
    expect(jsonPointer(["", "k"])).toBe("//k");
  });

  it("is stable for duplicate keys (pointer identifies the name, not the entry)", () => {
    const entries = objectOf(modelOf(DUPLICATE_EXAMPLE).node).entries;
    const pointers = entries.map((entry) => jsonPointer(["", entry.key].filter((part) => part !== "")));
    expect(pointers).toEqual(["/mode", "/mode"]);
  });
});

// --- format / minify -------------------------------------------------------

describe("formatJson / minifyJson — round trip", () => {
  it("formats config.json and re-parses to an equivalent model", () => {
    const model = modelOf(CONFIG_EXAMPLE);
    const formatted = formatJson(model);
    expect(formatted).not.toBeNull();
    const reparsed = modelOf(formatted ?? "");
    expect(plain(reparsed.node)).toEqual(plain(model.node));
    expect(formatted).toContain("9007199254740993");
    expect(formatted).toContain('"Температура"');
    // Two-space indentation by default, one level per nesting.
    expect(formatted?.split("\n")[1]).toBe('  "project": "DaVinci",');
  });

  it("minifies idempotently and preserves lexemes", () => {
    const model = modelOf(CONFIG_EXAMPLE);
    const once = minifyJson(model);
    expect(once).not.toBeNull();
    const twice = minifyJson(modelOf(once ?? ""));
    expect(twice).toBe(once);
    expect(once).toContain('"preciseInteger":9007199254740993');
  });

  it("honours a custom indent", () => {
    const formatted = formatJson(modelOf('{"a":[1,2]}'), "    ");
    expect(formatted).toBe('{\n    "a": [\n        1,\n        2\n    ]\n}');
  });

  it("serialises one node compactly for copy", () => {
    const root = objectOf(modelOf(CONFIG_EXAMPLE).node);
    const channels = root.entries.find((entry) => entry.key === "channels")?.value;
    if (!channels) throw new Error("channels missing");
    expect(minifyNode(channels)).toBe('[{"name":"RPM","unit":"rpm"},{"name":"Температура","unit":"°C"}]');
  });

  it("refuses to format or minify a truncated model", () => {
    const deep = "[".repeat(MAX_DEPTH + 8) + "]".repeat(MAX_DEPTH + 8);
    const model = modelOf(deep);
    expect(model.truncated).toBe(true);
    expect(formatJson(model)).toBeNull();
    expect(minifyJson(model)).toBeNull();
  });
});

// --- limits ----------------------------------------------------------------

describe("parseJson — depth and size limits", () => {
  it("truncates input nested deeper than MAX_DEPTH with a warning", () => {
    const depth = MAX_DEPTH + 64;
    const source = "[".repeat(depth) + "]".repeat(depth);
    const started = Date.now();
    const result = parseJson(source);
    const elapsed = Date.now() - started;

    expect(result.model).not.toBeNull();
    expect(result.model?.truncated).toBe(true);
    const warning = result.diagnostics.find((item) => item.severity === "warning");
    expect(warning?.message).toMatch(/deeper than/i);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("truncates a document holding more than MAX_NODES values", () => {
    const source = `[${Array.from({ length: MAX_NODES + 1_000 }, (_, index) => index).join(",")}]`;
    const started = Date.now();
    const result = parseJson(source);
    const elapsed = Date.now() - started;

    expect(result.model?.truncated).toBe(true);
    const warning = result.diagnostics.find((item) => item.severity === "warning");
    expect(warning?.message).toMatch(/more than/i);
    expect(elapsed).toBeLessThan(10_000);
  });

  it("still parses a flat array that is large but within the limit", () => {
    const items = 50_000;
    const source = `[${Array.from({ length: items }, (_, index) => index).join(",")}]`;
    const model = modelOf(source);
    expect(model.truncated).toBe(false);
    const node = model.node;
    if (node.kind !== "array") throw new Error("expected an array");
    expect(node.items).toHaveLength(items);
  });
});

// --- offset → line/column --------------------------------------------------

describe("line index", () => {
  it("maps offsets with CRLF and without", () => {
    const lf = '{\n  "a": 1\n}';
    const lfStarts = buildLineIndex(lf);
    expect(lfStarts).toEqual([0, 2, 11]);
    expect(lineColumnAt(lfStarts, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt(lfStarts, 2)).toEqual({ line: 2, column: 1 });
    expect(lineColumnAt(lfStarts, 6)).toEqual({ line: 2, column: 5 });
    expect(lineColumnAt(lfStarts, 11)).toEqual({ line: 3, column: 1 });

    const crlf = '{"a":1}\r\n{"b":2}';
    const crlfStarts = buildLineIndex(crlf);
    expect(crlfStarts).toEqual([0, 9]);
    expect(lineColumnAt(crlfStarts, 9)).toEqual({ line: 2, column: 1 });
  });

  it("counts columns in UTF-16 units", () => {
    const source = '"😀x"';
    const starts = buildLineIndex(source);
    expect(lineColumnAt(starts, 3)).toEqual({ line: 1, column: 4 });
  });
});

// --- outline ---------------------------------------------------------------

describe("jsonOutline", () => {
  it("lists root keys with nested containers and their source lines", () => {
    const outline = jsonOutline(CONFIG_EXAMPLE);
    expect(outline.map((item) => item.text)).toEqual([
      "project",
      "enabled",
      "serial",
      "preciseInteger",
      "channels",
      "note",
    ]);
    expect(outline.every((item) => item.level === 1)).toBe(true);
    expect(outline.map((item) => item.line)).toEqual([2, 3, 4, 5, 6, 16]);
    expect(outline.map((item) => item.id)).toEqual([
      "json:/0",
      "json:/1",
      "json:/2",
      "json:/3",
      "json:/4",
      "json:/5",
    ]);

    const channels = outline[4];
    expect(channels?.children.map((item) => item.text)).toEqual(["[0]", "[1]"]);
    expect(channels?.children.map((item) => item.level)).toEqual([2, 2]);
    expect(channels?.children[0]?.children.map((item) => item.text)).toEqual(["name", "unit"]);
    expect(channels?.children[0]?.children.map((item) => item.level)).toEqual([3, 3]);
  });

  it("shows duplicate keys as separate entries", () => {
    const outline = jsonOutline(DUPLICATE_EXAMPLE);
    expect(outline.map((item) => item.text)).toEqual(["mode", "mode"]);
    expect(outline.map((item) => item.id)).toEqual(["json:/0", "json:/1"]);
  });

  it("returns nothing for an unparsable document or a primitive root", () => {
    expect(jsonOutline(INVALID_EXAMPLE)).toEqual([]);
    expect(jsonOutline("")).toEqual([]);
    expect(jsonOutline("42")).toEqual([]);
    expect(jsonOutline('"text"')).toEqual([]);
  });

  it("bounds the entry list", () => {
    const keys = Array.from({ length: MAX_OUTLINE_ITEMS + 50 }, (_, index) => `"k${index}": ${index}`).join(
      ",",
    );
    const outline = jsonOutline(`{${keys}}`);
    expect(outline).toHaveLength(MAX_OUTLINE_ITEMS);
  });
});

// --- module contract -------------------------------------------------------

describe("json module contract", () => {
  it("exports the FormatModule the registry expects", () => {
    expect(jsonModule.kind).toBe("json");
    expect(typeof jsonModule.Viewer).toBe("function");
    expect(typeof jsonModule.outline).toBe("function");
    expect(jsonModule.outline?.(CONFIG_EXAMPLE)).toHaveLength(6);
  });

  it("re-exports the same parser from the module entry point", () => {
    expect(parseJsonFromModule).toBe(parseJson);
  });

  it("defers building the tree for documents above 2 MiB", () => {
    expect(HEAVY_CONTENT_LIMIT).toBe(2 * 1024 * 1024);
    expect(shouldDeferBuild("{}")).toBe(false);
    expect(shouldDeferBuild("x".repeat(HEAVY_CONTENT_LIMIT))).toBe(false);
    expect(shouldDeferBuild("x".repeat(HEAVY_CONTENT_LIMIT + 1))).toBe(true);
  });
});

// --- the kit examples on disk ---------------------------------------------

describe.runIf(HAS_KIT)("DaVinci_Render_Kit/examples", () => {
  it("parses config.json from disk exactly like the inline copy", () => {
    const onDisk = readFileSync(join(KIT_EXAMPLES, "config.json"), "utf8");
    expect(plain(modelOf(onDisk).node)).toEqual(plain(modelOf(CONFIG_EXAMPLE).node));
    expect(onDisk.trimEnd()).toBe(CONFIG_EXAMPLE.trimEnd());
  });

  it("warns about duplicate.json from disk", () => {
    const onDisk = readFileSync(join(KIT_EXAMPLES, "duplicate.json"), "utf8");
    const result = parseJson(onDisk);
    const entries = objectOf(result.model?.node as JsonNode).entries;
    expect(entries.map((entry) => entry.key)).toEqual(["mode", "mode"]);
    expect(result.diagnostics.filter((item) => item.severity === "warning")).toHaveLength(1);
  });

  it("reports invalid.json from disk as a trailing comma", () => {
    const onDisk = readFileSync(join(KIT_EXAMPLES, "invalid.json"), "utf8");
    const result = parseJson(onDisk);
    expect(result.model).toBeNull();
    expect(result.diagnostics.some((item) => /trailing comma/i.test(item.message))).toBe(true);
  });
});

// --- viewer ---------------------------------------------------------------

describe("JsonViewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    // jsdom does not implement element scrolling; SourceView calls scrollTo.
    Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, value: () => {} });
    // Tell React this file drives updates through act().
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderViewer(source: string, replaceEnabled = true) {
    const jump = vi.fn();
    const replace = vi.fn();
    const props: ViewerProps = {
      content: source,
      documentId: "doc-json",
      revision: 0,
      appearance: "light",
      onJumpToLine: jump,
      ...(replaceEnabled ? { onReplaceContent: replace } : {}),
    };
    act(() => {
      root.render(createElement(JsonViewer, props));
    });
    return { jump, replace };
  }

  function buttons(): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>(".format-viewer-tools button")];
  }

  function buttonWithLabel(label: string): HTMLButtonElement | undefined {
    return buttons().find((button) => button.textContent === label);
  }

  function rows(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(".format-json-row")];
  }

  it("renders the tree with the exact number lexeme and collapsed containers", () => {
    renderViewer(CONFIG_EXAMPLE);

    expect(rows().length).toBeGreaterThan(0);
    expect(container.textContent).toContain("DaVinci");
    expect(container.textContent).toContain("9007199254740993");
    expect(container.textContent).toContain("2 elements");
    // channels is a nested container and starts collapsed.
    expect(container.textContent).not.toContain('"RPM"');
  });

  it("expands and collapses a container on the toggle", () => {
    renderViewer(CONFIG_EXAMPLE);

    const channelsRow = rows().find((row) => row.textContent?.includes("channels"));
    expect(channelsRow).toBeDefined();
    const toggle = channelsRow?.querySelector(".format-tree-toggle");
    expect(toggle).not.toBeNull();

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Array items are objects, shown as indices and still collapsed.
    expect(container.textContent).toContain("[0]");
    expect(container.textContent).toContain("[1]");
    expect(container.textContent).not.toContain('"RPM"');

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("[0]");

    act(() => {
      buttonWithLabel("Expand all")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain('"RPM"');
  });

  it("shows both duplicate entries and one warning", () => {
    renderViewer(DUPLICATE_EXAMPLE);

    const modeRows = rows().filter((row) => row.textContent?.includes("mode"));
    expect(modeRows).toHaveLength(2);
    expect(container.textContent).toContain('"first"');
    expect(container.textContent).toContain('"second"');
    expect(container.textContent).toContain("Duplicate key");
  });

  it("keeps the source and hides the tree for invalid input", () => {
    renderViewer(INVALID_EXAMPLE);

    expect(container.textContent).toContain("Invalid JSON");
    expect(container.querySelectorAll(".format-source-line").length).toBeGreaterThan(0);
    expect(rows()).toHaveLength(0);
    expect(buttonWithLabel("Format")?.disabled).toBe(true);
    expect(buttonWithLabel("Minify")?.disabled).toBe(true);
    // The trailing comma is reported and clickable.
    const diagnostic = container.querySelector(".format-diagnostic.is-error");
    expect(diagnostic?.textContent).toContain("2:18");
  });

  it("formats and minifies only through the explicit commands", () => {
    const { replace } = renderViewer(CONFIG_EXAMPLE);

    act(() => {
      buttonWithLabel("Format")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(replace).toHaveBeenCalledTimes(1);
    const formatted = replace.mock.calls[0]?.[0] as string;
    expect(formatted).toContain("9007199254740993");
    expect(formatted).toContain('"Температура"');
    expect(parseJson(formatted).model).not.toBeNull();

    act(() => {
      buttonWithLabel("Minify")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace.mock.calls[1]?.[0] as string).toContain('"preciseInteger":9007199254740993');
  });

  it("does not offer format commands without onReplaceContent", () => {
    renderViewer(CONFIG_EXAMPLE, false);
    expect(buttonWithLabel("Format")?.disabled).toBe(true);
    expect(buttonWithLabel("Minify")?.disabled).toBe(true);
  });

  it("jumps to the source line when a row is activated", () => {
    const { jump } = renderViewer(CONFIG_EXAMPLE);

    const rootRow = rows()[0];
    act(() => {
      rootRow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(jump).toHaveBeenCalledWith(1, 1);

    const serialRow = rows().find((row) => row.textContent?.includes('"serial"'));
    act(() => {
      serialRow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(jump).toHaveBeenLastCalledWith(4, 3);

    // A plain click (pointerdown) jumps too.
    act(() => {
      serialRow?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(jump).toHaveBeenLastCalledWith(4, 3);
    expect(jump).toHaveBeenCalledTimes(3);
  });

  it("offers an escaped JSON Pointer per row", () => {
    renderViewer('{"a/b": 1, "x~y": {"deep": true}}');

    const slashRow = rows().find((row) => row.textContent?.includes('"a/b"'));
    const pointerButton = slashRow?.querySelector('[aria-label="Copy JSON Pointer"]');
    expect(pointerButton?.getAttribute("title")).toContain("/a~1b");

    const parentRow = rows().find((row) => row.textContent?.includes('"x~y"'));
    act(() => {
      parentRow
        ?.querySelector(".format-tree-toggle")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const deepRow = rows().find((row) => row.textContent?.includes('"deep"'));
    expect(deepRow?.querySelector('[aria-label="Copy JSON Pointer"]')?.getAttribute("title")).toContain(
      "/x~0y/deep",
    );
  });

  it("filters rows by key and value text", () => {
    renderViewer(CONFIG_EXAMPLE);

    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    if (!input) return;

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(input, "rpm");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain('"RPM"');
    expect(container.textContent).not.toContain("preciseInteger");

    act(() => {
      setValue?.call(input, "nothing-matches-this");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No matches");
  });

  it("does not build the tree for a document above the heavy limit until asked", () => {
    renderViewer(`{}${" ".repeat(HEAVY_CONTENT_LIMIT)}`);

    expect(container.textContent).toContain("The file is large");
    expect(buttonWithLabel("Build view")).toBeDefined();
    expect(rows()).toHaveLength(0);

    act(() => {
      buttonWithLabel("Build view")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(buttonWithLabel("Build view")).toBeUndefined();
    expect(rows().length).toBeGreaterThan(0);
  });
});
