/**
 * XML parser and lossless syntax model.
 *
 * The document is parsed by hand rather than through `DOMParser`: the tree has
 * to keep the source order of text, CDATA, comments and processing
 * instructions, and every node needs its UTF-16 range so the viewer can jump
 * back into the editor. An XML→JSON shortcut would lose repeated tags and mixed
 * content, which is exactly what the calibration document tests.
 *
 * Nothing here loads a DTD or resolves an external entity. A DOCTYPE is kept as
 * plain text behind a warning and unknown entities stay literal, so opening a
 * hostile file cannot make the editor touch the network or the disk.
 */

import type { Diagnostic, ParseResult } from "@/documents/types";
import { t } from "@/shared/i18n";

/** Documents above this size open on the Source tab first; the tree is built on demand. */
export const XML_HEAVY_BYTES = 2 * 1024 * 1024;

/** Hard parser limit. Bigger buffers are still editable and saveable, just not viewable. */
export const XML_MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/** Deepest element nesting the tree view accepts before refusing the document. */
export const XML_MAX_DEPTH = 256;

/** Node budget; exceeding it keeps the parsed prefix and marks the model truncated. */
export const XML_MAX_NODES = 100_000;

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Kind of a node in the lossless tree. */
export type XmlNodeKind = "declaration" | "doctype" | "element" | "text" | "cdata" | "comment" | "processing";

/** One attribute, with its own source range so a value can be selected exactly. */
export interface XmlAttribute {
  /** Qualified name as written, e.g. `xml:space`. */
  name: string;
  prefix: string | null;
  localName: string;
  /** Resolved namespace URI; `null` for unprefixed attributes, which inherit nothing. */
  namespaceUri: string | null;
  /** Value after entity decoding. */
  value: string;
  /** Range of the whole `name="value"` pair. */
  from: number;
  to: number;
  /** Range of the value without quotes. */
  valueFrom: number;
  valueTo: number;
  quote: '"' | "'";
}

/** Prefix declaration carried by an element, in source order. */
export interface XmlNamespaceDeclaration {
  /** Prefix, or `""` for the default namespace. */
  prefix: string;
  uri: string;
  from: number;
  to: number;
}

/** One node in the lossless tree. */
export interface XmlNode {
  kind: XmlNodeKind;
  /** Qualified name for elements, the target for processing instructions, `#text` etc. otherwise. */
  name: string;
  prefix: string | null;
  localName: string;
  /** Element namespace URI; `null` when the name has no prefix and no default namespace. */
  namespaceUri: string | null;
  attributes: XmlAttribute[];
  children: XmlNode[];
  /** Character data for text, CDATA, comment, processing, doctype and declaration nodes. */
  text: string;
  /** Namespace prefixes declared on this element. */
  namespaces: XmlNamespaceDeclaration[];
  /** Effective `xml:space` after inheritance from the parent. */
  preserveSpace: boolean;
  selfClosing: boolean;
  /** Range of the complete construct (`<a/>`, `<!-- … -->`, `&#x0;` expanded text). */
  from: number;
  to: number;
  /** 1-based position of `from`. */
  line: number;
  column: number;
}

/** Whole document: top-level constructs in source order plus shortcuts to the interesting ones. */
export interface XmlDocument {
  /** Declaration, DOCTYPE, comments, processing instructions and the root, in source order. */
  nodes: XmlNode[];
  root: XmlNode | null;
  declaration: XmlNode | null;
  doctype: XmlNode | null;
  /** Namespaces declared on the root element. */
  namespaces: XmlNamespaceDeclaration[];
  /** Number of element nodes in the model. */
  elementCount: number;
  /** True when the node budget cut the model short. */
  truncated: boolean;
}

class XmlSyntaxError extends Error {
  readonly from: number;
  readonly to: number;

  constructor(message: string, from: number, to: number) {
    super(message);
    this.name = "XmlSyntaxError";
    this.from = from;
    this.to = to;
  }
}

interface NamespaceScope {
  declarations: Map<string, string>;
  parent: NamespaceScope | null;
}

interface OpenElement {
  node: XmlNode;
  scope: NamespaceScope;
}

function isNameStart(code: number): boolean {
  return (
    code >= 0x80 ||
    code === 0x3a || // :
    code === 0x5f || // _
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

function isNameChar(code: number): boolean {
  return (
    isNameStart(code) ||
    code === 0x2d || // -
    code === 0x2e || // .
    (code >= 0x30 && code <= 0x39)
  );
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Start offsets of every line.
 *
 * CRLF is one terminator, a lone CR is one too — the same split
 * `SourceView` and CodeMirror use, so a diagnostic lands on the right line.
 */
function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 0x0a) {
      starts.push(index + 1);
    } else if (code === 0x0d) {
      if (source.charCodeAt(index + 1) === 0x0a) {
        starts.push(index + 2);
        index += 1;
      } else {
        starts.push(index + 1);
      }
    }
  }
  return starts;
}

/** 1-based line and column for a UTF-16 offset. */
export function positionAt(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

type WarningSink = (message: string, from: number, to: number) => void;

/**
 * Decode the five predefined entities and character references.
 *
 * An unknown named entity is a warning rather than an error: the text stays
 * literal instead of the parser pretending the document could not be read at
 * all. DTD entities are never loaded, so this is the only honest behaviour.
 */
function decodeEntities(raw: string, base: number, warn: WarningSink): string {
  if (!raw.includes("&")) return raw;

  let result = "";
  let index = 0;
  while (index < raw.length) {
    const ampersand = raw.indexOf("&", index);
    if (ampersand === -1) {
      result += raw.slice(index);
      break;
    }
    result += raw.slice(index, ampersand);

    const semicolon = raw.indexOf(";", ampersand + 1);
    if (semicolon === -1) {
      throw new XmlSyntaxError("Unterminated entity reference.", base + ampersand, base + raw.length);
    }

    const body = raw.slice(ampersand + 1, semicolon);
    const from = base + ampersand;
    const to = base + semicolon + 1;
    result += decodeEntity(body, from, to, warn);
    index = semicolon + 1;
  }
  return result;
}

function decodeEntity(body: string, from: number, to: number, warn: WarningSink): string {
  switch (body) {
    case "lt":
      return "<";
    case "gt":
      return ">";
    case "amp":
      return "&";
    case "quot":
      return '"';
    case "apos":
      return "'";
    default:
      break;
  }

  if (body.startsWith("#")) {
    const hexadecimal = body[1] === "x" || body[1] === "X";
    const digits = body.slice(hexadecimal ? 2 : 1);
    const pattern = hexadecimal ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/;
    if (!pattern.test(digits)) {
      throw new XmlSyntaxError(`Invalid character reference "&${body};".`, from, to);
    }
    const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
    const valid = Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    if (!valid) {
      throw new XmlSyntaxError(
        `Character reference "&${body};" is outside the XML character range.`,
        from,
        to,
      );
    }
    return String.fromCodePoint(code);
  }

  warn(`Unknown entity "&${body};" is kept as text; DTD entities are never loaded.`, from, to);
  return `&${body};`;
}

/** Attributes of the XML declaration, which are the same syntax without a namespace. */
function declarationAttributes(body: string, base: number): XmlAttribute[] {
  const attributes: XmlAttribute[] = [];
  const pattern = /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = pattern.exec(body);
  while (match !== null) {
    const name = match[1];
    const doubleQuoted = match[2] !== undefined;
    const value = (doubleQuoted ? match[2] : match[3]) ?? "";
    const quote: '"' | "'" = doubleQuoted ? '"' : "'";
    const nameIndex = match.index;
    const valueIndex = base + nameIndex + match[0].indexOf(quote) + 1;
    attributes.push({
      name,
      prefix: null,
      localName: name,
      namespaceUri: null,
      value,
      from: base + nameIndex,
      to: base + nameIndex + match[0].length,
      valueFrom: valueIndex,
      valueTo: valueIndex + value.length,
      quote,
    });
    match = pattern.exec(body);
  }
  return attributes;
}

class XmlScanner {
  private readonly source: string;
  private readonly starts: readonly number[];
  private readonly diagnostics: Diagnostic[];
  private readonly startIndex: number;
  private readonly nodes: XmlNode[] = [];
  private readonly stack: OpenElement[] = [];
  private index: number;
  private root: XmlNode | null = null;
  private declaration: XmlNode | null = null;
  private doctype: XmlNode | null = null;
  private nodeCount = 0;
  private elementCount = 0;
  private truncated = false;

  constructor(source: string, diagnostics: Diagnostic[], starts: readonly number[]) {
    this.source = source;
    this.diagnostics = diagnostics;
    this.starts = starts;
    this.startIndex = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.index = this.startIndex;
  }

  scan(): XmlDocument {
    while (this.index < this.source.length && !this.truncated) {
      if (this.source.startsWith("<!--", this.index)) {
        this.parseComment();
      } else if (this.source.startsWith("<![CDATA[", this.index)) {
        this.parseCdata();
      } else if (this.source.startsWith("<?", this.index)) {
        this.parseProcessing();
      } else if (this.source.startsWith("</", this.index)) {
        this.parseEndTag();
      } else if (this.startsWithIgnoreCase("<!DOCTYPE", this.index)) {
        this.parseDoctype();
      } else if (this.source.startsWith("<!", this.index)) {
        this.fail("Unsupported markup declaration.", this.index, this.index + 2);
      } else if (this.source[this.index] === "<") {
        this.parseStartTag();
      } else {
        this.parseText();
      }
    }
    return this.document();
  }

  private startsWithIgnoreCase(needle: string, offset: number): boolean {
    return this.source.slice(offset, offset + needle.length).toUpperCase() === needle.toUpperCase();
  }

  private report(severity: "warning" | "error", message: string, from: number, to: number): void {
    const position = positionAt(this.starts, from);
    this.diagnostics.push({ severity, message, from, to, line: position.line, column: position.column });
  }

  private fail(message: string, from: number, to: number): never {
    throw new XmlSyntaxError(message, from, to);
  }

  private position(offset: number): { line: number; column: number } {
    return positionAt(this.starts, offset);
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && isWhitespace(this.source.charCodeAt(this.index))) {
      this.index += 1;
    }
  }

  private readName(what: string): string {
    const from = this.index;
    if (this.index >= this.source.length || !isNameStart(this.source.charCodeAt(this.index))) {
      this.fail(`Expected ${what}.`, from, Math.min(this.source.length, from + 1));
    }
    while (this.index < this.source.length && isNameChar(this.source.charCodeAt(this.index))) {
      this.index += 1;
    }
    return this.source.slice(from, this.index);
  }

  /** Add a node to the open element, or to the top level, and count it against the budget. */
  private addNode(node: XmlNode): void {
    this.nodeCount += 1;
    if (this.nodeCount > XML_MAX_NODES) {
      if (!this.truncated) {
        this.truncated = true;
        this.report("warning", t("viewer.truncated"), node.from, Math.min(this.source.length, node.from + 1));
      }
      return;
    }

    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].node.children.push(node);
    } else {
      this.nodes.push(node);
    }
    if (node.kind === "element") {
      this.elementCount += 1;
      if (this.stack.length === 0) this.root = node;
    }
  }

  private createNode(
    kind: XmlNodeKind,
    name: string,
    from: number,
    to: number,
    extra: Partial<XmlNode> = {},
  ): XmlNode {
    const position = this.position(from);
    return {
      kind,
      name,
      prefix: null,
      localName: name,
      namespaceUri: null,
      attributes: [],
      children: [],
      text: "",
      namespaces: [],
      preserveSpace: false,
      selfClosing: false,
      from,
      to,
      line: position.line,
      column: position.column,
      ...extra,
    };
  }

  private splitName(name: string, from: number, to: number): { prefix: string | null; localName: string } {
    const colon = name.indexOf(":");
    if (colon === -1) return { prefix: null, localName: name };
    if (colon === 0 || colon === name.length - 1 || name.indexOf(":", colon + 1) !== -1) {
      this.fail(`Invalid qualified name "${name}".`, from, to);
    }
    return { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
  }

  private resolveNamespace(
    scope: NamespaceScope | null,
    prefix: string | null,
    from: number,
    to: number,
  ): string | null {
    if (prefix === "xml") return XML_NAMESPACE;
    if (prefix === "xmlns") return XMLNS_NAMESPACE;

    const key = prefix ?? "";
    let current = scope;
    while (current !== null) {
      const uri = current.declarations.get(key);
      if (uri !== undefined) return uri === "" ? null : uri;
      current = current.parent;
    }

    if (prefix !== null) {
      this.report("warning", `Namespace prefix "${prefix}" is not declared.`, from, to);
    }
    return null;
  }

  private parseText(): void {
    const from = this.index;
    const next = this.source.indexOf("<", from);
    const to = next === -1 ? this.source.length : next;
    const raw = this.source.slice(from, to);

    if (this.stack.length === 0) {
      if (raw.trim() !== "") {
        this.fail("Text is not allowed outside the root element.", from, to);
      }
      this.index = to;
      return;
    }

    const open = this.stack[this.stack.length - 1];
    const text = decodeEntities(raw, from, (message, warnFrom, warnTo) => {
      this.report("warning", message, warnFrom, warnTo);
    });
    this.addNode(
      this.createNode("text", "#text", from, to, {
        localName: "#text",
        text,
        preserveSpace: open.node.preserveSpace,
      }),
    );
    this.index = to;
  }

  private parseComment(): void {
    const from = this.index;
    const close = this.source.indexOf("-->", from + 4);
    if (close === -1) this.fail("Unterminated comment.", from, this.source.length);
    this.index = close + 3;
    this.addNode(
      this.createNode("comment", "#comment", from, this.index, {
        localName: "#comment",
        text: this.source.slice(from + 4, close),
      }),
    );
  }

  private parseCdata(): void {
    const from = this.index;
    if (this.stack.length === 0) {
      this.fail(
        "CDATA sections are only allowed inside an element.",
        from,
        Math.min(this.source.length, from + 9),
      );
    }
    const close = this.source.indexOf("]]>", from + 9);
    if (close === -1) this.fail("Unterminated CDATA section.", from, this.source.length);
    this.index = close + 3;
    this.addNode(
      this.createNode("cdata", "#cdata", from, this.index, {
        localName: "#cdata",
        text: this.source.slice(from + 9, close),
        preserveSpace: this.stack[this.stack.length - 1].node.preserveSpace,
      }),
    );
  }

  private parseProcessing(): void {
    const from = this.index;
    this.index += 2;
    const target = this.readName("processing instruction target");
    const targetTo = this.index;
    const isDeclaration = target.toLowerCase() === "xml";

    if (isDeclaration && from !== this.startIndex) {
      this.fail("The XML declaration must be the first construct in the document.", from, targetTo);
    }

    const close = this.source.indexOf("?>", this.index);
    if (close === -1)
      this.fail(`Unterminated processing instruction <?${target}?>.`, from, this.source.length);
    const body = this.source.slice(this.index, close);
    this.index = close + 2;

    if (isDeclaration) {
      const node = this.createNode("declaration", "xml", from, this.index, {
        localName: "xml",
        text: body.trim(),
        attributes: declarationAttributes(body, targetTo),
      });
      this.declaration = node;
      this.addNode(node);
      return;
    }

    this.addNode(
      this.createNode("processing", target, from, this.index, {
        localName: target,
        text: body.trim(),
        attributes: [],
      }),
    );
  }

  private parseDoctype(): void {
    const from = this.index;
    if (this.stack.length > 0) {
      this.fail(
        "A DOCTYPE declaration must appear before the root element.",
        from,
        Math.min(this.source.length, from + 9),
      );
    }

    let cursor = from + 9;
    let depth = 0;
    let quote: string | null = null;
    let closed = false;
    while (cursor < this.source.length) {
      const character = this.source[cursor];
      if (quote !== null) {
        if (character === quote) quote = null;
        cursor += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "[") {
        depth += 1;
      } else if (character === "]") {
        depth -= 1;
      } else if (character === ">" && depth <= 0) {
        cursor += 1;
        closed = true;
        break;
      }
      cursor += 1;
    }
    if (!closed) this.fail("Unterminated DOCTYPE declaration.", from, this.source.length);
    this.index = cursor;

    // The internal subset is never interpreted: entities are not loaded, so a
    // DOCTYPE can only ever be a warning plus literal text.
    this.report("warning", t("viewer.xml.doctype"), from, cursor);
    if (this.doctype !== null) {
      this.report("warning", "Only the first DOCTYPE declaration is kept.", from, cursor);
      return;
    }
    if (this.root !== null) {
      this.report("warning", "A DOCTYPE declaration should appear before the root element.", from, cursor);
    }
    const node = this.createNode("doctype", "#doctype", from, cursor, {
      localName: "#doctype",
      text: this.source.slice(from, cursor),
    });
    this.doctype = node;
    this.addNode(node);
  }

  private parseAttribute(): XmlAttribute {
    const nameFrom = this.index;
    const name = this.readName("attribute name");
    const nameTo = this.index;
    this.skipWhitespace();
    if (this.source[this.index] !== "=") {
      this.fail(
        `Attribute "${name}" is missing "=".`,
        this.index,
        Math.min(this.source.length, this.index + 1),
      );
    }
    this.index += 1;
    this.skipWhitespace();

    const quote = this.source[this.index];
    if (quote !== '"' && quote !== "'") {
      this.fail(
        `The value of attribute "${name}" must be quoted.`,
        this.index,
        Math.min(this.source.length, this.index + 1),
      );
    }

    const valueFrom = this.index + 1;
    const valueTo = this.source.indexOf(quote, valueFrom);
    if (valueTo === -1)
      this.fail(`Unterminated value for attribute "${name}".`, valueFrom, this.source.length);
    const lessThan = this.source.indexOf("<", valueFrom);
    if (lessThan !== -1 && lessThan < valueTo) {
      this.fail(`The value of attribute "${name}" must not contain "<".`, lessThan, lessThan + 1);
    }

    const value = decodeEntities(this.source.slice(valueFrom, valueTo), valueFrom, (message, from, to) => {
      this.report("warning", message, from, to);
    });
    this.index = valueTo + 1;

    const split = this.splitName(name, nameFrom, nameTo);
    return {
      name,
      prefix: split.prefix,
      localName: split.localName,
      namespaceUri: null,
      value,
      from: nameFrom,
      to: this.index,
      valueFrom,
      valueTo,
      quote,
    };
  }

  private parseStartTag(): void {
    const tagStart = this.index;
    if (this.stack.length >= XML_MAX_DEPTH) {
      this.fail(
        `Maximum element depth of ${XML_MAX_DEPTH} is exceeded.`,
        tagStart,
        Math.min(this.source.length, tagStart + 1),
      );
    }

    this.index += 1;
    const nameFrom = this.index;
    const name = this.readName("element name");
    const nameTo = this.index;

    if (this.stack.length === 0 && this.root !== null) {
      this.fail(`Only one root element is allowed; found <${name}>.`, tagStart, nameTo);
    }

    const attributes: XmlAttribute[] = [];
    let selfClosing = false;
    for (;;) {
      this.skipWhitespace();
      if (this.index >= this.source.length) {
        this.fail(`Unterminated start tag <${name}>.`, tagStart, this.source.length);
      }
      const character = this.source[this.index];
      if (character === "/") {
        if (this.source[this.index + 1] !== ">") {
          this.fail('Expected ">" after "/" in a start tag.', this.index, this.index + 2);
        }
        selfClosing = true;
        this.index += 2;
        break;
      }
      if (character === ">") {
        this.index += 1;
        break;
      }

      const attribute = this.parseAttribute();
      if (attributes.some((existing) => existing.name === attribute.name)) {
        this.fail(`Duplicate attribute "${attribute.name}".`, attribute.from, attribute.to);
      }
      attributes.push(attribute);
    }

    const parentScope = this.stack.length > 0 ? this.stack[this.stack.length - 1].scope : null;
    const scope: NamespaceScope = { declarations: new Map(), parent: parentScope };
    const namespaces: XmlNamespaceDeclaration[] = [];

    // Declarations first: an attribute may use a prefix declared later in the
    // same tag, because attribute order carries no meaning in XML.
    for (const attribute of attributes) {
      if (attribute.name === "xmlns") {
        scope.declarations.set("", attribute.value);
        namespaces.push({ prefix: "", uri: attribute.value, from: attribute.from, to: attribute.to });
      } else if (attribute.prefix === "xmlns") {
        if (attribute.localName === "xmlns") {
          this.fail('The prefix "xmlns" must not be declared.', attribute.from, attribute.to);
        }
        if (attribute.localName === "xml" && attribute.value !== XML_NAMESPACE) {
          this.fail(`The prefix "xml" is reserved for ${XML_NAMESPACE}.`, attribute.from, attribute.to);
        }
        scope.declarations.set(attribute.localName, attribute.value);
        namespaces.push({
          prefix: attribute.localName,
          uri: attribute.value,
          from: attribute.from,
          to: attribute.to,
        });
      }
    }

    for (const attribute of attributes) {
      if (attribute.name === "xmlns" || attribute.prefix === "xmlns") {
        attribute.namespaceUri = XMLNS_NAMESPACE;
      } else if (attribute.prefix !== null) {
        attribute.namespaceUri = this.resolveNamespace(scope, attribute.prefix, attribute.from, attribute.to);
      }
    }

    const split = this.splitName(name, nameFrom, nameTo);
    let preserveSpace = this.stack.length > 0 ? this.stack[this.stack.length - 1].node.preserveSpace : false;
    for (const attribute of attributes) {
      if (attribute.namespaceUri === XML_NAMESPACE && attribute.localName === "space") {
        if (attribute.value === "preserve") {
          preserveSpace = true;
        } else if (attribute.value === "default") {
          preserveSpace = false;
        } else {
          this.report(
            "warning",
            `Invalid xml:space value "${attribute.value}"; expected "preserve" or "default".`,
            attribute.from,
            attribute.to,
          );
        }
      }
    }

    const node = this.createNode("element", name, tagStart, this.index, {
      prefix: split.prefix,
      localName: split.localName,
      namespaceUri: this.resolveNamespace(scope, split.prefix, nameFrom, nameTo),
      attributes,
      namespaces,
      preserveSpace,
      selfClosing,
    });
    this.addNode(node);

    if (!selfClosing) this.stack.push({ node, scope });
  }

  private parseEndTag(): void {
    const tagStart = this.index;
    this.index += 2;
    const name = this.readName("element name");
    this.skipWhitespace();
    if (this.source[this.index] !== ">") {
      this.fail(
        `Expected ">" in closing tag </${name}>.`,
        this.index,
        Math.min(this.source.length, this.index + 1),
      );
    }
    this.index += 1;

    if (this.stack.length === 0) {
      this.fail(`Unexpected closing tag </${name}>.`, tagStart, this.index);
    }
    const open = this.stack[this.stack.length - 1];
    if (open.node.name !== name) {
      this.fail(
        `Mismatched closing tag: expected </${open.node.name}>, found </${name}>.`,
        tagStart,
        this.index,
      );
    }
    open.node.to = this.index;
    this.stack.pop();
  }

  private document(): XmlDocument {
    if (!this.truncated && this.stack.length > 0) {
      const open = this.stack[this.stack.length - 1].node;
      this.fail(
        `Unclosed element <${open.name}>.`,
        open.from,
        Math.min(this.source.length, open.from + open.name.length + 2),
      );
    }
    this.stack.length = 0;

    if (!this.truncated && this.root === null) {
      this.report("warning", "The document has no root element.", 0, Math.min(this.source.length, 1));
    }

    return {
      nodes: this.nodes,
      root: this.root,
      declaration: this.declaration,
      doctype: this.doctype,
      namespaces: this.root === null ? [] : this.root.namespaces,
      elementCount: this.elementCount,
      truncated: this.truncated,
    };
  }
}

/**
 * Build the lossless model of an XML document.
 *
 * The model is `null` only when the document is not well formed: in that case
 * the diagnostics carry the position of the first failure and the viewer keeps
 * showing the source, so a typo never hides the file.
 */
export function parseXml(source: string): ParseResult<XmlDocument> {
  const diagnostics: Diagnostic[] = [];
  const starts = lineStartsOf(source);

  if (source.length > XML_MAX_SOURCE_BYTES) {
    const position = positionAt(starts, 0);
    diagnostics.push({
      severity: "error",
      message: `The document is too large to parse (${source.length} characters, limit ${XML_MAX_SOURCE_BYTES}).`,
      from: 0,
      to: Math.min(source.length, 1),
      line: position.line,
      column: position.column,
    });
    return { model: null, diagnostics };
  }

  try {
    return { model: new XmlScanner(source, diagnostics, starts).scan(), diagnostics };
  } catch (error) {
    if (error instanceof XmlSyntaxError) {
      const position = positionAt(starts, error.from);
      diagnostics.push({
        severity: "error",
        message: error.message,
        from: error.from,
        to: error.to,
        line: position.line,
        column: position.column,
      });
      return { model: null, diagnostics };
    }
    throw error;
  }
}
