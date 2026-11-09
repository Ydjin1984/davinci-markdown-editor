/**
 * Lossless JSON parser.
 *
 * The document text stays the only source of truth, so this parser never
 * converts a value into a JavaScript one: numbers keep their exact lexeme
 * (`9007199254740993` must not become `9007199254740992`), strings keep their
 * raw form (escapes survive a format/minify round trip), object entries keep
 * source order, and duplicate keys stay as separate entries.
 *
 * It touches no DOM, never throws, and reports every problem as a
 * `Diagnostic` with UTF-16 offsets plus 1-based line and column. Two hard
 * limits — nesting depth and node count — turn runaway input into a truncated
 * model with a warning instead of a frozen UI.
 */

import type { Diagnostic, ParseResult } from "@/documents/types";
import { t } from "@/shared/i18n";

/**
 * Deepest nesting the model is allowed to contain. Deeper input yields a
 * truncated model and a warning instead of a stack overflow.
 */
export const MAX_DEPTH = 512;

/** Most values the model may hold before parsing is truncated. */
export const MAX_NODES = 250_000;

/** A parsed string: the decoded value plus the exact source lexeme. */
export interface JsonStringNode {
  kind: "string";
  /** Decoded value, escapes resolved. */
  value: string;
  /** Exact source text, quotes and escapes included. */
  raw: string;
  /** UTF-16 offset of the opening quote. */
  from: number;
  /** UTF-16 offset just past the closing quote. */
  to: number;
}

/** A parsed number. Only the lexeme is kept — never a rounded JavaScript number. */
export interface JsonNumberNode {
  kind: "number";
  /** Exact source lexeme, e.g. `-1.25e+10` or `9007199254740993`. */
  raw: string;
  from: number;
  to: number;
}

export interface JsonBooleanNode {
  kind: "boolean";
  value: boolean;
  raw: string;
  from: number;
  to: number;
}

export interface JsonNullNode {
  kind: "null";
  raw: string;
  from: number;
  to: number;
}

export interface JsonArrayNode {
  kind: "array";
  items: JsonNode[];
  from: number;
  to: number;
}

/** One `"key": value` pair, kept even when the key repeats. */
export interface JsonObjectEntry {
  /** Decoded key text. */
  key: string;
  /** Exact source lexeme of the key, quotes and escapes included. */
  rawKey: string;
  keyFrom: number;
  keyTo: number;
  value: JsonNode;
  /** True when an earlier entry in the same object already used this key. */
  duplicate: boolean;
}

export interface JsonObjectNode {
  kind: "object";
  entries: JsonObjectEntry[];
  from: number;
  to: number;
}

/** Placeholder for the part of a document that hit a parser limit. */
export interface JsonTruncatedNode {
  kind: "truncated";
  from: number;
  to: number;
}

export type JsonNode =
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode
  | JsonArrayNode
  | JsonObjectNode
  | JsonTruncatedNode;

/** What a successful parse returns. */
export interface JsonRoot {
  node: JsonNode;
  /** True when a depth or size limit cut the model short. */
  truncated: boolean;
}

/** Offsets of every line start, for O(log n) offset → line/column mapping. */
export function buildLineIndex(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/**
 * 1-based line and column for a UTF-16 offset.
 *
 * Columns count UTF-16 code units from the line start, exactly like
 * CodeMirror, so a surrogate pair moves the column by two.
 */
export function lineColumnAt(lineStarts: number[], offset: number): { line: number; column: number } {
  const target = Math.max(0, offset);
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= target) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: target - (lineStarts[low] ?? 0) + 1 };
}

/** Internal abort used for syntax errors; never escapes `parseJson`. */
class JsonSyntaxAbort extends Error {
  readonly offset: number;
  readonly end: number;

  constructor(message: string, offset: number, end: number) {
    super(message);
    this.name = "JsonSyntaxAbort";
    this.offset = offset;
    this.end = end;
  }
}

/** Sticky JSON-number grammar, so no substring copy is needed per number. */
const NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Characters that cannot legally follow a number; seeing one means the lexeme was cut. */
const NUMBER_TAIL = /[0-9A-Za-z._+-]/;

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function describeCharacter(character: string): string {
  const code = character.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) {
    return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return character;
}

class JsonParser {
  private readonly source: string;
  private readonly lineStarts: number[];
  private readonly diagnostics: Diagnostic[] = [];
  private index = 0;
  private nodes = 0;
  private truncated = false;

  constructor(source: string) {
    this.source = source;
    this.lineStarts = buildLineIndex(source);
  }

  parse(): ParseResult<JsonRoot> {
    try {
      const model = this.parseDocument();
      return { model, diagnostics: this.diagnostics };
    } catch (error) {
      if (error instanceof JsonSyntaxAbort) {
        this.report("error", error.message, error.offset, error.end);
        return { model: null, diagnostics: this.diagnostics };
      }
      // Defensive: a parser bug must degrade to "cannot view", never to a
      // thrown exception in the preview pane.
      this.report(
        "error",
        "The parser stopped unexpectedly while reading this document",
        Math.min(this.index, this.source.length),
        Math.min(this.index + 1, this.source.length),
      );
      return { model: null, diagnostics: this.diagnostics };
    }
  }

  private parseDocument(): JsonRoot {
    // A UTF-8 BOM is common in files saved on Windows; it carries no JSON
    // meaning, so it is skipped rather than reported as a syntax error.
    if (this.source.charCodeAt(0) === 0xfeff) this.index = 1;

    this.skipWhitespace();
    if (this.index >= this.source.length) {
      this.fail("The document is empty — there is no JSON value to show", this.index, this.index);
    }

    const node = this.parseValue(0);

    if (!this.truncated) {
      this.skipWhitespace();
      if (this.index < this.source.length) {
        this.fail(
          `Unexpected content after the JSON value: “${this.source.slice(this.index, this.index + 12)}”`,
          this.index,
          Math.min(this.index + 12, this.source.length),
        );
      }
    }

    return { node, truncated: this.truncated };
  }

  private report(severity: Diagnostic["severity"], message: string, from: number, to: number): void {
    const position = lineColumnAt(this.lineStarts, from);
    this.diagnostics.push({
      severity,
      message,
      from,
      to: Math.max(from, to),
      line: position.line,
      column: position.column,
    });
  }

  private fail(message: string, offset: number, end: number): never {
    throw new JsonSyntaxAbort(message, offset, end);
  }

  /** `//` and `/*` are not JSON; name the rule instead of "unexpected character". */
  private failOnComment(character: string | undefined, offset: number): void {
    if (character !== "/") return;
    this.fail(
      "Comments are not allowed in a JSON document",
      offset,
      Math.min(offset + 2, this.source.length),
    );
  }

  private skipWhitespace(): void {
    const source = this.source;
    while (this.index < source.length) {
      const code = source.charCodeAt(this.index);
      // JSON only allows space, tab, LF and CR between tokens.
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) this.index += 1;
      else break;
    }
  }

  private truncatedNode(): JsonTruncatedNode {
    const from = Math.min(this.index, this.source.length);
    return { kind: "truncated", from, to: Math.min(from + 1, this.source.length) };
  }

  /** Records the first limit hit; later hits are already explained. */
  private truncate(message: string, offset: number): void {
    if (this.truncated) return;
    this.truncated = true;
    this.report("warning", message, offset, Math.min(offset + 1, this.source.length));
  }

  private parseValue(depth: number): JsonNode {
    if (this.truncated) return this.truncatedNode();

    if (depth > MAX_DEPTH) {
      this.truncate(
        `The document nests deeper than ${MAX_DEPTH} levels — the tree is truncated; the source is unchanged`,
        this.index,
      );
      return this.truncatedNode();
    }

    if (this.nodes >= MAX_NODES) {
      this.truncate(
        `The document holds more than ${MAX_NODES} values — the tree is truncated; the source is unchanged`,
        this.index,
      );
      return this.truncatedNode();
    }
    this.nodes += 1;

    this.skipWhitespace();
    if (this.index >= this.source.length) {
      this.fail("Unexpected end of input — a value was expected", this.index, this.source.length);
    }

    const character = this.source[this.index];
    switch (character) {
      case '"':
        return this.parseString();
      case "{":
        return this.parseObject(depth);
      case "[":
        return this.parseArray(depth);
      case "t":
        return this.parseBoolean(true);
      case "f":
        return this.parseBoolean(false);
      case "n":
        return this.parseNull();
      case "/":
        return this.fail(
          "Comments are not allowed in a JSON document",
          this.index,
          Math.min(this.index + 2, this.source.length),
        );
      case "'":
        return this.fail(
          "JSON strings must use double quotes",
          this.index,
          Math.min(this.index + 1, this.source.length),
        );
      default:
        if (character === "-" || (character >= "0" && character <= "9")) return this.parseNumber();
        return this.fail(
          `Unexpected character “${describeCharacter(character)}” — a JSON value was expected`,
          this.index,
          Math.min(this.index + 1, this.source.length),
        );
    }
  }

  private parseBoolean(value: boolean): JsonBooleanNode {
    const from = this.index;
    const word = value ? "true" : "false";
    this.expectKeyword(word);
    return { kind: "boolean", value, raw: this.source.slice(from, this.index), from, to: this.index };
  }

  private parseNull(): JsonNullNode {
    const from = this.index;
    this.expectKeyword("null");
    return { kind: "null", raw: this.source.slice(from, this.index), from, to: this.index };
  }

  private expectKeyword(word: string): void {
    if (!this.source.startsWith(word, this.index)) {
      const preview =
        /^[A-Za-z0-9_$]+/.exec(this.source.slice(this.index, this.index + 16))?.[0] ??
        this.source[this.index];
      this.fail(
        `Unexpected token “${preview}” — expected ${word}`,
        this.index,
        Math.min(this.index + Math.max(preview.length, 1), this.source.length),
      );
    }
    this.index += word.length;
  }

  private parseNumber(): JsonNumberNode {
    const from = this.index;
    NUMBER_PATTERN.lastIndex = from;
    const match = NUMBER_PATTERN.exec(this.source);
    if (!match) {
      this.fail("Invalid number literal", from, this.extendToWordEnd(from));
    }

    const to = NUMBER_PATTERN.lastIndex;
    let end = to;
    while (end < this.source.length && NUMBER_TAIL.test(this.source[end])) end += 1;
    if (end > to) {
      this.fail(
        `Invalid number literal “${this.source.slice(from, end)}” — check the leading zero, sign or exponent`,
        from,
        end,
      );
    }

    this.index = to;
    return { kind: "number", raw: this.source.slice(from, to), from, to };
  }

  /** End offset of the run of number-ish or word-ish characters at `from`. */
  private extendToWordEnd(from: number): number {
    let end = from + 1;
    while (end < this.source.length && NUMBER_TAIL.test(this.source[end])) end += 1;
    return Math.min(end, this.source.length);
  }

  private parseString(): JsonStringNode {
    const from = this.index;
    this.index += 1;

    let value = "";
    let chunkStart = this.index;

    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);

      if (code === 0x22) {
        value += this.source.slice(chunkStart, this.index);
        this.index += 1;
        return { kind: "string", value, raw: this.source.slice(from, this.index), from, to: this.index };
      }

      if (code === 0x5c) {
        value += this.source.slice(chunkStart, this.index);
        this.index += 1;
        if (this.index >= this.source.length) {
          this.fail("Unterminated string — the escape sequence is cut off", from, this.source.length);
        }
        const escape = this.source[this.index];
        if (escape === "u") {
          const hex = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            this.fail(
              "Invalid \\u escape — four hexadecimal digits are required",
              this.index - 1,
              Math.min(this.index + 5, this.source.length),
            );
          }
          value += String.fromCharCode(parseInt(hex, 16));
          this.index += 5;
        } else {
          const replacement = ESCAPES[escape];
          if (replacement === undefined) {
            this.fail(
              `Invalid escape sequence “\\${describeCharacter(escape)}”`,
              this.index - 1,
              Math.min(this.index + 1, this.source.length),
            );
          }
          value += replacement;
          this.index += 1;
        }
        chunkStart = this.index;
        continue;
      }

      if (code < 0x20) {
        const name =
          code === 0x0a
            ? "LF"
            : code === 0x0d
              ? "CR"
              : code === 0x09
                ? "TAB"
                : describeCharacter(this.source[this.index]);
        this.fail(
          `Unescaped control character (${name}) inside a string — escape it as \\u${code
            .toString(16)
            .toUpperCase()
            .padStart(4, "0")}`,
          this.index,
          this.index + 1,
        );
      }

      this.index += 1;
    }

    this.fail("Unterminated string — a closing quote is missing", from, this.source.length);
  }

  private parseArray(depth: number): JsonArrayNode {
    const from = this.index;
    this.index += 1;
    const items: JsonNode[] = [];

    this.skipWhitespace();
    if (this.index < this.source.length && this.source[this.index] === "]") {
      this.index += 1;
      return { kind: "array", items, from, to: this.index };
    }

    let lastComma = -1;
    for (;;) {
      this.skipWhitespace();
      if (this.index >= this.source.length) {
        this.fail("Unterminated array — a closing ']' is missing", from, this.source.length);
      }
      if (this.source[this.index] === "]") {
        this.fail(
          "Trailing comma before ']' — JSON does not allow a comma after the last element",
          lastComma >= 0 ? lastComma : this.index,
          Math.min(this.index + 1, this.source.length),
        );
      }

      items.push(this.parseValue(depth + 1));
      if (this.truncated) return { kind: "array", items, from, to: this.index };

      this.skipWhitespace();
      if (this.index >= this.source.length) {
        this.fail("Unterminated array — a closing ']' is missing", from, this.source.length);
      }
      const next = this.source[this.index];
      if (next === ",") {
        lastComma = this.index;
        this.index += 1;
        continue;
      }
      if (next === "]") {
        this.index += 1;
        return { kind: "array", items, from, to: this.index };
      }
      this.failOnComment(next, this.index);
      this.fail(
        `Expected ',' or ']' after an array element, found “${describeCharacter(next)}”`,
        this.index,
        Math.min(this.index + 1, this.source.length),
      );
    }
  }

  private parseObject(depth: number): JsonObjectNode {
    const from = this.index;
    this.index += 1;
    const entries: JsonObjectEntry[] = [];

    this.skipWhitespace();
    if (this.index < this.source.length && this.source[this.index] === "}") {
      this.index += 1;
      return { kind: "object", entries, from, to: this.index };
    }

    const seenKeys = new Map<string, number>();
    let lastComma = -1;

    for (;;) {
      this.skipWhitespace();
      if (this.index >= this.source.length) {
        this.fail("Unterminated object — a closing '}' is missing", from, this.source.length);
      }
      const character = this.source[this.index];
      if (character === "}") {
        this.fail(
          "Trailing comma before '}' — JSON does not allow a comma after the last pair",
          lastComma >= 0 ? lastComma : this.index,
          Math.min(this.index + 1, this.source.length),
        );
      }
      this.failOnComment(character, this.index);
      if (character !== '"') {
        this.fail(
          `Expected a double-quoted property name, found “${describeCharacter(character)}”`,
          this.index,
          Math.min(this.index + 1, this.source.length),
        );
      }

      const keyNode = this.parseString();
      this.skipWhitespace();
      if (this.index >= this.source.length || this.source[this.index] !== ":") {
        this.fail(
          `Expected ':' after the property name “${keyNode.value}”`,
          this.index,
          Math.min(this.index + 1, this.source.length),
        );
      }
      this.index += 1;

      const value = this.parseValue(depth + 1);

      const previous = seenKeys.get(keyNode.value) ?? 0;
      seenKeys.set(keyNode.value, previous + 1);
      const duplicate = previous > 0;
      entries.push({
        key: keyNode.value,
        rawKey: keyNode.raw,
        keyFrom: keyNode.from,
        keyTo: keyNode.to,
        value,
        duplicate,
      });
      if (duplicate) {
        this.report("warning", t("viewer.json.duplicate", { key: keyNode.value }), keyNode.from, keyNode.to);
      }

      if (this.truncated) return { kind: "object", entries, from, to: this.index };

      this.skipWhitespace();
      if (this.index >= this.source.length) {
        this.fail("Unterminated object — a closing '}' is missing", from, this.source.length);
      }
      const next = this.source[this.index];
      if (next === ",") {
        lastComma = this.index;
        this.index += 1;
        continue;
      }
      if (next === "}") {
        this.index += 1;
        return { kind: "object", entries, from, to: this.index };
      }
      this.failOnComment(next, this.index);
      this.fail(
        `Expected ',' or '}' after a property value, found “${describeCharacter(next)}”`,
        this.index,
        Math.min(this.index + 1, this.source.length),
      );
    }
  }
}

/**
 * Parse JSON into a lossless model.
 *
 * Never throws: a syntax error yields `model: null` plus an error diagnostic
 * with the exact range, and a depth/size overflow yields a truncated model
 * plus a warning.
 */
export function parseJson(source: string): ParseResult<JsonRoot> {
  return new JsonParser(source).parse();
}

/** Serialise one node. `indent === null` produces the minified form. */
function nodeText(node: JsonNode, indent: string | null, depth: number): string {
  switch (node.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return node.raw;
    case "truncated":
      return "";
    case "array": {
      if (node.items.length === 0) return "[]";
      if (indent === null) return `[${node.items.map((item) => nodeText(item, null, depth + 1)).join(",")}]`;
      const pad = indent.repeat(depth);
      const inner = indent.repeat(depth + 1);
      const parts = node.items.map((item) => `${inner}${nodeText(item, indent, depth + 1)}`);
      return `[\n${parts.join(",\n")}\n${pad}]`;
    }
    case "object": {
      if (node.entries.length === 0) return "{}";
      const pairs = node.entries.map((entry) => {
        const separator = indent === null ? ":" : ": ";
        return `${entry.rawKey}${separator}${nodeText(entry.value, indent, depth + 1)}`;
      });
      if (indent === null) return `{${pairs.join(",")}}`;
      const pad = indent.repeat(depth);
      const inner = indent.repeat(depth + 1);
      return `{\n${pairs.map((pair) => `${inner}${pair}`).join(",\n")}\n${pad}}`;
    }
  }
}

/**
 * Pretty-print a valid model.
 *
 * Raw number lexemes, string escapes, key order and duplicate keys are kept
 * exactly; only whitespace between tokens changes. Returns `null` for a
 * truncated model, because formatting a partial tree would silently drop data.
 */
export function formatJson(root: JsonRoot, indent = "  "): string | null {
  if (root.truncated) return null;
  return nodeText(root.node, indent, 0);
}

/** Minify a valid model, keeping every lexeme. Returns `null` when truncated. */
export function minifyJson(root: JsonRoot): string | null {
  if (root.truncated) return null;
  return nodeText(root.node, null, 0);
}

/**
 * Compact JSON text for one node, used by "copy value".
 *
 * A truncated node has no text; the viewer offers copy only for real values.
 */
export function minifyNode(node: JsonNode): string {
  return nodeText(node, null, 0);
}
