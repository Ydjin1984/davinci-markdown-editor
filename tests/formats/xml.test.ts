/**
 * XML module contract.
 *
 * The calibration document is the acceptance fixture: root namespace, two
 * elements with the same name, an attribute, a comment, CDATA and mixed content
 * in one file. `invalid.xml` is the other half of the contract — a broken
 * document must keep its source and report a position, not disappear.
 *
 * The fixture text is inlined instead of read from `DaVinci_Render_Kit`, because
 * the kit lives outside this repository and CI has no copy of it.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/shared/i18n";
import { xmlOutline } from "@/formats/xml/outline";
import {
  parseXml,
  XML_MAX_DEPTH,
  type XmlDocument,
  type XmlNode,
  type XmlNodeKind,
} from "@/formats/xml/parse";
import { XmlViewer } from "@/formats/xml/XmlViewer";

const CALIBRATION = `<?xml version="1.0" encoding="UTF-8"?>
<calibration xmlns="urn:davinci:demo" version="1">
  <!-- Два канала, исходный порядок важен -->
  <channel id="rpm" unit="rpm">1000</channel>
  <channel id="tps" unit="%">18</channel>
  <description>До <b>важно</b> после</description>
  <raw><![CDATA[rpm < 7000 && load > 0]]></raw>
  <spacing xml:space="preserve">  сохранить пробелы  </spacing>
</calibration>
`;

const INVALID = `<root>
  <item>значение</root>
`;

function parseOk(source: string): XmlDocument {
  const result = parseXml(source);
  if (result.model === null) {
    const reasons = result.diagnostics.map((item) => item.message).join("; ");
    throw new Error(`Expected a model, got: ${reasons}`);
  }
  return result.model;
}

function elementsOf(node: XmlNode): XmlNode[] {
  return node.children.filter((child) => child.kind === "element");
}

function elementsNamed(node: XmlNode, name: string): XmlNode[] {
  return elementsOf(node).filter((child) => child.name === name);
}

function kindsOf(nodes: readonly XmlNode[]): XmlNodeKind[] {
  return nodes.map((node) => node.kind);
}

function firstError(source: string) {
  const { diagnostics } = parseXml(source);
  const error = diagnostics.find((item) => item.severity === "error");
  if (error === undefined) throw new Error("Expected an error diagnostic.");
  return error;
}

function renderViewer(content: string): string {
  return renderToStaticMarkup(
    createElement(XmlViewer, {
      content,
      documentId: "xml-doc",
      revision: 1,
      appearance: "light" as const,
      onJumpToLine: () => undefined,
    }),
  );
}

describe("calibration.xml", () => {
  it("parses without diagnostics and keeps the declared namespace", () => {
    const { model, diagnostics } = parseXml(CALIBRATION);
    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    if (model === null) throw new Error("unreachable");

    expect(model.root?.name).toBe("calibration");
    expect(model.root?.prefix).toBeNull();
    expect(model.root?.localName).toBe("calibration");
    expect(model.root?.namespaceUri).toBe("urn:davinci:demo");
    expect(model.namespaces.map((namespace) => [namespace.prefix, namespace.uri])).toEqual([
      ["", "urn:davinci:demo"],
    ]);
    expect(model.root?.attributes.map((attribute) => [attribute.name, attribute.value])).toEqual([
      ["xmlns", "urn:davinci:demo"],
      ["version", "1"],
    ]);
  });

  it("keeps the XML declaration with its pseudo-attributes", () => {
    const model = parseOk(CALIBRATION);
    expect(model.declaration?.attributes.map((attribute) => [attribute.name, attribute.value])).toEqual([
      ["version", "1.0"],
      ["encoding", "UTF-8"],
    ]);
    expect(model.nodes[0].kind).toBe("declaration");
    expect(CALIBRATION.slice(model.nodes[0].from, model.nodes[0].to)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>',
    );
  });

  it("keeps both channel elements as separate nodes with their attributes", () => {
    const model = parseOk(CALIBRATION);
    if (model.root === null) throw new Error("unreachable");

    const channels = elementsNamed(model.root, "channel");
    expect(channels).toHaveLength(2);
    expect(
      channels.map((channel) => channel.attributes.find((attribute) => attribute.name === "id")?.value),
    ).toEqual(["rpm", "tps"]);
    expect(
      channels.map((channel) => channel.attributes.find((attribute) => attribute.name === "unit")?.value),
    ).toEqual(["rpm", "%"]);
    expect(channels.map((channel) => channel.children[0]?.text)).toEqual(["1000", "18"]);
    expect(channels[0].line).toBe(4);
    expect(CALIBRATION.slice(channels[0].from, channels[0].to)).toBe(
      '<channel id="rpm" unit="rpm">1000</channel>',
    );
  });

  it("keeps the comment, the CDATA section and the source order", () => {
    const model = parseOk(CALIBRATION);
    if (model.root === null) throw new Error("unreachable");

    const withoutText = model.root.children.filter((child) => child.kind !== "text");
    expect(kindsOf(withoutText)).toEqual(["comment", "element", "element", "element", "element", "element"]);
    expect(withoutText.map((node) => node.name)).toEqual([
      "#comment",
      "channel",
      "channel",
      "description",
      "raw",
      "spacing",
    ]);

    const comment = withoutText[0];
    expect(comment.text).toBe(" Два канала, исходный порядок важен ");

    const raw = elementsNamed(model.root, "raw")[0];
    expect(raw.children).toHaveLength(1);
    expect(raw.children[0].kind).toBe("cdata");
    expect(raw.children[0].text).toBe("rpm < 7000 && load > 0");
  });

  it("keeps mixed content in source order", () => {
    const model = parseOk(CALIBRATION);
    if (model.root === null) throw new Error("unreachable");

    const description = elementsNamed(model.root, "description")[0];
    expect(
      description.children.map((child) => [child.kind, child.kind === "element" ? child.name : child.text]),
    ).toEqual([
      ["text", "До "],
      ["element", "b"],
      ["text", " после"],
    ]);
    expect(CALIBRATION.slice(description.children[0].from, description.children[0].to)).toBe("До ");
    expect(CALIBRATION.slice(description.children[2].from, description.children[2].to)).toBe(" после");
  });

  it("honours xml:space=preserve and inherits the flag downwards", () => {
    const model = parseOk(CALIBRATION);
    if (model.root === null) throw new Error("unreachable");

    const spacing = elementsNamed(model.root, "spacing")[0];
    expect(spacing.preserveSpace).toBe(true);
    expect(spacing.attributes.find((attribute) => attribute.name === "xml:space")?.namespaceUri).toBe(
      "http://www.w3.org/XML/1998/namespace",
    );
    expect(spacing.children[0].text).toBe("  сохранить пробелы  ");
    expect(model.root.preserveSpace).toBe(false);
  });
});

describe("invalid.xml", () => {
  it("returns no model and reports the mismatched tag position", () => {
    const { model, diagnostics } = parseXml(INVALID);
    expect(model).toBeNull();
    expect(diagnostics).toHaveLength(1);

    const error = diagnostics[0];
    expect(error.severity).toBe("error");
    expect(error.line).toBe(2);
    expect(error.column).toBe(17);
    expect(error.from).toBe(INVALID.indexOf("</root>"));
    expect(INVALID.slice(error.from, error.to)).toBe("</root>");
    expect(error.message).toContain("item");
    expect(error.message).toContain("root");
  });
});

describe("structure", () => {
  it("keeps repeated tags as separate nodes", () => {
    const model = parseOk("<r><i>1</i><i>2</i></r>");
    const items = elementsOf(model.root as XmlNode);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.name)).toEqual(["i", "i"]);
    expect(items.map((item) => item.children[0].text)).toEqual(["1", "2"]);
  });

  it("keeps self-closing elements and their source range", () => {
    const source = "<r><a/><b x='1' /></r>";
    const model = parseOk(source);
    const children = elementsOf(model.root as XmlNode);
    expect(children.map((child) => child.selfClosing)).toEqual([true, true]);
    expect(source.slice(children[1].from, children[1].to)).toBe("<b x='1' />");
  });

  it("keeps comments, CDATA and processing instructions in source order", () => {
    const model = parseOk("<r><?target value?><!-- note --><![CDATA[<raw>]]><b/></r>");
    const root = model.root as XmlNode;
    expect(kindsOf(root.children)).toEqual(["processing", "comment", "cdata", "element"]);
    expect(root.children[0].name).toBe("target");
    expect(root.children[0].text).toBe("value");
    expect(root.children[1].text).toBe(" note ");
    expect(root.children[2].text).toBe("<raw>");
  });

  it("keeps top-level comments and instructions around the root", () => {
    const model = parseOk('<!-- header --><?app version="1"?><r/><!-- footer -->');
    expect(kindsOf(model.nodes)).toEqual(["comment", "processing", "element", "comment"]);
    expect(model.root?.name).toBe("r");
  });

  it("counts elements for the summary strip", () => {
    expect(parseOk(CALIBRATION).elementCount).toBe(7);
  });
});

describe("entities", () => {
  it("decodes the predefined entities and character references", () => {
    const model = parseOk(`<r a="&lt;&amp;&quot;&apos;&#65;&#x42;">&amp;&lt;&gt;&#x1F600;</r>`);
    const root = model.root as XmlNode;
    expect(root.attributes[0].value).toBe(`<&"'AB`);
    expect(root.children[0].text).toBe(`&<>${String.fromCodePoint(0x1f600)}`);
  });

  it("keeps an unknown entity as text with a warning instead of loading a DTD", () => {
    const { model, diagnostics } = parseXml("<r>&nbsp;</r>");
    expect(model).not.toBeNull();
    expect(model?.root?.children[0].text).toBe("&nbsp;");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("nbsp");
  });

  it("rejects an unterminated entity reference", () => {
    const { model } = parseXml("<r>a & b</r>");
    expect(model).toBeNull();
    expect(firstError("<r>a & b</r>").message).toContain("entity");
  });

  it("rejects an invalid character reference", () => {
    const { model } = parseXml("<r>&#xZZ;</r>");
    expect(model).toBeNull();
    expect(firstError("<r>&#xZZ;</r>").message).toContain("character reference");
  });
});

describe("namespaces", () => {
  it("resolves prefixed and default namespaces, and keeps prefixed attributes apart", () => {
    const source = `<p:root xmlns:p="urn:demo" xmlns="urn:default" plain="1"><child p:id="7"/></p:root>`;
    const model = parseOk(source);
    const root = model.root as XmlNode;
    expect(root.prefix).toBe("p");
    expect(root.localName).toBe("root");
    expect(root.namespaceUri).toBe("urn:demo");
    expect(root.attributes.find((attribute) => attribute.name === "plain")?.namespaceUri).toBeNull();

    const child = elementsOf(root)[0];
    expect(child.namespaceUri).toBe("urn:default");
    expect(child.attributes[0].name).toBe("p:id");
    expect(child.attributes[0].namespaceUri).toBe("urn:demo");
  });

  it("resolves a prefix declared later in the same tag", () => {
    const model = parseOk(`<r p:a="1" xmlns:p="urn:x"/>`);
    expect(model.root?.attributes[0].namespaceUri).toBe("urn:x");
  });

  it("warns about an undeclared prefix but keeps the document viewable", () => {
    const { model, diagnostics } = parseXml("<q:r/>");
    expect(model).not.toBeNull();
    expect(model?.root?.namespaceUri).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("q");
  });
});

describe("xml:space", () => {
  it("inherits preserve and lets default switch it back off", () => {
    const model = parseOk(`<r xml:space="preserve"><a>  x  </a><b xml:space="default">  y  </b></r>`);
    const root = model.root as XmlNode;
    const [a, b] = elementsOf(root);
    expect(root.preserveSpace).toBe(true);
    expect(a.preserveSpace).toBe(true);
    expect(b.preserveSpace).toBe(false);
  });

  it("warns about an invalid value", () => {
    const { diagnostics } = parseXml(`<r xml:space="keep"/>`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("xml:space");
  });
});

describe("empty input and BOM", () => {
  it("returns an empty model plus a warning for empty input", () => {
    const { model, diagnostics } = parseXml("");
    expect(model).not.toBeNull();
    expect(model?.nodes).toEqual([]);
    expect(model?.root).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("treats whitespace-only input as an empty document", () => {
    const { model } = parseXml(" \n\t\r\n");
    expect(model).not.toBeNull();
    expect(model?.root).toBeNull();
  });

  it("skips a leading byte-order mark without creating a text node", () => {
    const model = parseOk("\uFEFF<r/>");
    expect(model.root?.name).toBe("r");
    expect(model.root?.from).toBe(1);
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0].kind).toBe("element");
  });

  it("still recognises the declaration after a byte-order mark", () => {
    const model = parseOk('\uFEFF<?xml version="1.0"?><r/>');
    expect(model.declaration).not.toBeNull();
    expect(model.root?.name).toBe("r");
  });
});

describe("DOCTYPE", () => {
  it("reports the declaration as a warning and never resolves its entities", () => {
    const source = `<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY custom "value">]>\n<r>&custom;</r>`;
    const { model, diagnostics } = parseXml(source);
    expect(model).not.toBeNull();
    expect(model?.doctype?.text).toContain("<!DOCTYPE r");
    expect(model?.root?.children[0].text).toBe("&custom;");

    const doctypeWarning = diagnostics.find((item) => item.message.toLowerCase().includes("doctype"));
    expect(doctypeWarning?.severity).toBe("warning");
    const entityWarning = diagnostics.find((item) => item.message.includes("custom"));
    expect(entityWarning?.severity).toBe("warning");
  });
});

describe("limits", () => {
  it("rejects a document that nests deeper than the limit instead of freezing", () => {
    const deep = "<a>".repeat(XML_MAX_DEPTH + 1) + "</a>".repeat(XML_MAX_DEPTH + 1);
    const { model } = parseXml(deep);
    expect(model).toBeNull();
    expect(firstError(deep).message).toContain("depth");
  });

  it("accepts a document exactly at the depth limit", () => {
    const deep = "<a>".repeat(XML_MAX_DEPTH) + "</a>".repeat(XML_MAX_DEPTH);
    expect(parseXml(deep).model).not.toBeNull();
  });
});

describe("viewer", () => {
  it("renders the tree with namespaces, mixed content and CDATA", () => {
    const html = renderViewer(CALIBRATION);
    expect(html).toContain("urn:davinci:demo");
    expect(html).toContain("channel");
    expect(html).toContain(t("viewer.xml.cdata"));
    expect(html).toContain("До");
  });

  it("keeps the source available when the document is not well formed", () => {
    const html = renderViewer(INVALID);
    expect(html).toContain(t("viewer.xml.invalid"));
    expect(html).toContain("2:17");
    expect(html).toContain("значение");
  });
});

describe("outline", () => {
  it("lists the element structure with levels and lines", () => {
    const outline = xmlOutline(CALIBRATION);
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe("calibration");
    expect(outline[0].level).toBe(1);
    expect(outline[0].line).toBe(2);
    expect(outline[0].children.map((item) => item.text)).toEqual([
      "channel",
      "channel",
      "description",
      "raw",
      "spacing",
    ]);
    expect(outline[0].children[0].level).toBe(2);
    expect(outline[0].children[0].line).toBe(4);
  });

  it("returns nothing for an unparseable document", () => {
    expect(xmlOutline(INVALID)).toEqual([]);
  });
});
