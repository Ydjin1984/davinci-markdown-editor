/**
 * CSV parser and table-view tests.
 *
 * The kit examples in `DaVinci_Render_Kit/examples` are the acceptance
 * fixtures, so they are read relative to the repository root rather than
 * duplicated into `tests/fixtures`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CsvViewer } from "@/formats/csv/CsvViewer";
import { csvOutline } from "@/formats/csv/outline";
import { detectDelimiter, parseCsv, type CsvTable } from "@/formats/csv/parse";
import { computeWindow, filterRecords, sortRecords, viewRecords } from "@/formats/csv/table";
import { t } from "@/shared/i18n";

const EXAMPLES = fileURLToPath(new URL("../../../DaVinci_Render_Kit/examples/", import.meta.url));

function example(name: string): string {
  return readFileSync(`${EXAMPLES}${name}`, "utf8");
}

function modelOf(source: string): CsvTable {
  const { model } = parseCsv(source);
  if (!model) throw new Error("parseCsv returned no model");
  return model;
}

describe("CSV parsing — kit examples", () => {
  it("parses telemetry.csv as 3 data records × 5 columns", () => {
    const { model, diagnostics } = parseCsv(example("telemetry.csv"));
    if (!model) throw new Error("no model");

    expect(model.dialect).toEqual({ delimiter: ",", detected: true });
    expect(model.hasHeader).toBe(true);
    expect(model.header).toEqual(["id", "rpm", "load", "note", "enabled"]);
    expect(model.records).toHaveLength(3);
    expect(model.width).toBe(5);
    expect(model.widthIssues).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("keeps values as source strings and preserves quoted commas and line breaks", () => {
    const table = modelOf(example("telemetry.csv"));

    // `001` stays a string: no numeric coercion, leading zeros intact.
    expect(table.records.map((record) => record.cells[0])).toEqual(["001", "002", "003"]);
    expect(typeof table.records[0].cells[0]).toBe("string");

    // A comma inside quotes does not split the record.
    expect(table.records[1].cells[3]).toBe("Нагрузка, частичная");
    expect(table.records[1].cells).toHaveLength(5);

    // An LF inside quotes stays part of the cell; outside EOLs are CRLF.
    expect(table.records[2].cells[3]).toBe("Первая строка\nВторая строка");
    expect(table.records[2].cells[4]).toBe("false");
  });

  it("tracks physical lines for a multiline record", () => {
    const table = modelOf(example("telemetry.csv"));

    expect(table.records[0].line).toBe(2);
    expect(table.records[0].endLine).toBe(2);
    expect(table.records[1].line).toBe(3);
    expect(table.records[1].endLine).toBe(3);
    expect(table.records[2].line).toBe(4);
    expect(table.records[2].endLine).toBe(5);
  });

  it("detects semicolons and keeps a decimal comma as text", () => {
    const table = modelOf(example("semicolon.csv"));

    expect(table.dialect).toEqual({ delimiter: ";", detected: true });
    expect(table.header).toEqual(["id", "value", "note"]);
    expect(table.records).toHaveLength(2);
    expect(table.width).toBe(3);

    expect(table.records[0].cells).toEqual(["001", "1,25", 'Кавычки "внутри"']);
    // The last two fields of the second record exist and are empty.
    expect(table.records[1].cells).toEqual(["002", "", ""]);
  });

  it("reports ragged width but keeps every value and its physical lines", () => {
    const { model, diagnostics } = parseCsv(example("ragged.csv"));
    if (!model) throw new Error("no model");

    expect(model.header).toEqual(["a", "b", "c"]);
    expect(model.width).toBe(4);
    expect(model.records).toHaveLength(2);
    expect(model.records[0].cells).toEqual(["1", "2"]);
    // The fourth value is not dropped just because the header has three.
    expect(model.records[1].cells).toEqual(["3", "4", "5", "6"]);

    expect(model.widthIssues).toEqual([
      { record: 2, lineFrom: 2, lineTo: 2, count: 2, expected: 3 },
      { record: 3, lineFrom: 3, lineTo: 3, count: 4, expected: 3 },
    ]);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].line).toBe(2);
    expect(diagnostics[0].column).toBe(1);
    expect(diagnostics[0].from).toBe(6);
    expect(diagnostics[0].message).toBe(t("viewer.csv.ragged", { record: 2, count: 2, expected: 3 }));
    expect(diagnostics[1].message).toBe(t("viewer.csv.ragged", { record: 3, count: 4, expected: 3 }));
  });

  it("reports the line range of a ragged multiline record", () => {
    const { model } = parseCsv('a,b\n"x\ny"\n1\n');
    if (!model) throw new Error("no model");

    expect(model.widthIssues).toEqual([
      { record: 2, lineFrom: 2, lineTo: 3, count: 1, expected: 2 },
      { record: 3, lineFrom: 4, lineTo: 4, count: 1, expected: 2 },
    ]);
  });
});

describe("CSV parsing — quoting, line endings, BOM", () => {
  it("unescapes doubled quotes", () => {
    const table = modelOf('a,b\n"x""y",2\n');
    expect(table.records[0].cells).toEqual(['x"y', "2"]);
  });

  it("keeps delimiters and quotes together inside a quoted field", () => {
    const table = modelOf('a,b\n"a,b""c",2\n');
    expect(table.records[0].cells).toEqual(['a,b"c', "2"]);
  });

  it("handles a quoted empty field", () => {
    const table = modelOf('a,b\n"",2\n');
    expect(table.records[0].cells).toEqual(["", "2"]);
  });

  it("accepts CRLF, LF and lone CR record terminators", () => {
    for (const source of ["a,b\r\n1,2\r\n", "a,b\n1,2\n", "a,b\r1,2\r"]) {
      const table = modelOf(source);
      expect(table.records).toHaveLength(1);
      expect(table.records[0].cells).toEqual(["1", "2"]);
      expect(table.records[0].line).toBe(2);
    }
  });

  it("keeps a CRLF line break inside a quoted cell verbatim", () => {
    const table = modelOf('a,b\r\n"x\r\ny",2\r\n');
    expect(table.records[0].cells).toEqual(["x\r\ny", "2"]);
    expect(table.records[0].endLine).toBe(3);
  });

  it("strips the UTF-8 BOM instead of gluing it to the first cell", () => {
    const table = modelOf("\uFEFFid,name\r\n1,Вася\r\n");
    expect(table.header).toEqual(["id", "name"]);
    expect(table.records[0].cells).toEqual(["1", "Вася"]);
  });

  it("returns an empty model for an empty (or BOM-only) file", () => {
    for (const source of ["", "\uFEFF"]) {
      const { model, diagnostics } = parseCsv(source);
      expect(model).not.toBeNull();
      expect(model?.records).toEqual([]);
      expect(model?.header).toBeNull();
      expect(model?.columns).toEqual([]);
      expect(model?.width).toBe(0);
      expect(diagnostics).toEqual([]);
    }
  });

  it("keeps empty and trailing fields", () => {
    const table = modelOf("a,b,\n1,2,,\n");
    expect(table.header).toEqual(["a", "b", ""]);
    expect(table.records[0].cells).toEqual(["1", "2", "", ""]);
    expect(table.width).toBe(4);
  });

  it("does not create a record for the final line terminator or blank lines", () => {
    const table = modelOf("a,b\n1,2\n\n3,4\n");
    expect(table.records).toHaveLength(2);
    expect(table.records[1].cells).toEqual(["3", "4"]);
    expect(table.records[1].line).toBe(4);
  });

  it("reports an unterminated quote without throwing", () => {
    const { model, diagnostics } = parseCsv('a,b\n"x');
    expect(model?.records[0].cells).toEqual(["x"]);
    expect(diagnostics.some((item) => item.message === t("viewer.truncated"))).toBe(true);
  });

  it("never throws on malformed input", () => {
    const inputs = ['"', "\r", ",", "\uFEFF", 'a,"b"c,d', "a\rb", '"a""""', "\0", "a;b\n1;2"];
    for (const source of inputs) {
      expect(() => parseCsv(source)).not.toThrow();
    }
  });
});

describe("CSV parsing — options", () => {
  it("turns the header off and treats the first record as data", () => {
    const { model } = parseCsv(example("telemetry.csv"), { header: false });
    if (!model) throw new Error("no model");

    expect(model.hasHeader).toBe(false);
    expect(model.header).toBeNull();
    expect(model.records).toHaveLength(4);
    expect(model.records[0].cells[0]).toBe("id");
    expect(model.columns.map((column) => column.label)).toEqual(["", "", "", "", ""]);
  });

  it("accepts a forced delimiter and reports that it was not detected", () => {
    const { model } = parseCsv("a;b\n1;2\n", { delimiter: ";" });
    expect(model?.dialect).toEqual({ delimiter: ";", detected: false });
    expect(model?.records[0].cells).toEqual(["1", "2"]);
  });

  it("gives duplicate headers positional ids without renaming the text", () => {
    const table = modelOf("a,a\n1,2\n");
    expect(table.columns.map((column) => column.id)).toEqual(["col-1", "col-2"]);
    expect(table.columns.map((column) => column.label)).toEqual(["a", "a"]);
  });

  it("keeps formula-looking cells as plain text", () => {
    const table = modelOf("value\n=1+1\n+2\n-3\n@cmd\n");
    expect(table.records.map((record) => record.cells[0])).toEqual(["=1+1", "+2", "-3", "@cmd"]);
  });
});

describe("CSV delimiter detection", () => {
  it("recognises every supported delimiter", () => {
    expect(detectDelimiter(example("telemetry.csv"))).toBe(",");
    expect(detectDelimiter(example("semicolon.csv"))).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(detectDelimiter("a|b\n1|2\n")).toBe("|");
    expect(detectDelimiter("\uFEFFa;b\n1;2\n")).toBe(";");
  });

  it("falls back to a comma when nothing splits", () => {
    expect(detectDelimiter("plain text without delimiters")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
});

describe("CSV table view", () => {
  it("sorts a copy and never mutates the parsed model", () => {
    const table = modelOf(example("telemetry.csv"));
    const before = table.records.map((record) => [...record.cells]);

    const sorted = sortRecords(table.records, { column: 1, direction: "desc" });
    expect(sorted).not.toBe(table.records);
    expect(sorted.map((record) => record.cells[0])).toEqual(["003", "002", "001"]);
    expect(sorted[0]).toBe(table.records[2]);

    // The model still has the original order and cells.
    expect(table.records.map((record) => [...record.cells])).toEqual(before);
  });

  it("sorts ascending, descending and back to none", () => {
    const table = modelOf("n\n2\n10\n1\n");

    expect(sortRecords(table.records, { column: 1, direction: "asc" }).map((r) => r.cells[0])).toEqual([
      "1",
      "10",
      "2",
    ]);
    expect(sortRecords(table.records, { column: 1, direction: "desc" }).map((r) => r.cells[0])).toEqual([
      "2",
      "10",
      "1",
    ]);
    expect(sortRecords(table.records, null).map((r) => r.cells[0])).toEqual(["2", "10", "1"]);
  });

  it("filters without touching the model", () => {
    const table = modelOf(example("telemetry.csv"));

    const filtered = filterRecords(table.records, "нагрузка");
    expect(filtered).not.toBe(table.records);
    expect(filtered.map((record) => record.cells[0])).toEqual(["002"]);
    expect(table.records).toHaveLength(3);

    const all = filterRecords(table.records, "   ");
    expect(all).not.toBe(table.records);
    expect(all).toHaveLength(3);
  });

  it("applies the filter before the sort", () => {
    const table = modelOf(example("telemetry.csv"));
    const rows = viewRecords(table.records, "00", { column: 1, direction: "desc" });
    expect(rows.map((record) => record.cells[0])).toEqual(["003", "002", "001"]);
  });

  it("windows 100 000 rows into a few dozen nodes", () => {
    const top = computeWindow(100_000, 0, 600, 28, 8);
    expect(top.first).toBe(0);
    expect(top.last).toBeGreaterThan(0);
    expect(top.last - top.first).toBeLessThanOrEqual(50);
    expect(top.totalHeight).toBe(2_800_000);

    const middle = computeWindow(100_000, 28 * 50_000, 600, 28, 8);
    expect(middle.first).toBe(50_000 - 8);
    expect(middle.last - middle.first).toBeLessThanOrEqual(50);
    expect(middle.offset).toBe((50_000 - 8) * 28);

    const bottom = computeWindow(100_000, 2_800_000, 600, 28, 8);
    expect(bottom.last).toBe(100_000);
    expect(bottom.last - bottom.first).toBeLessThanOrEqual(50);

    expect(computeWindow(0, 0, 600, 28, 8)).toEqual({
      first: 0,
      last: 0,
      offset: 0,
      height: 0,
      totalHeight: 0,
    });
  });
});

describe("CSV outline", () => {
  it("lists columns in order", () => {
    const outline = csvOutline(example("telemetry.csv"));
    expect(outline.map((item) => item.text)).toEqual(["id", "rpm", "load", "note", "enabled"]);
    expect(outline).toHaveLength(5);
    expect(outline[0]).toMatchObject({ id: "csv-col-1", level: 1, line: 1, children: [] });
  });

  it("is empty for an empty document", () => {
    expect(csvOutline("")).toEqual([]);
  });

  it("numbers columns that have no header text", () => {
    const outline = csvOutline(",,\n1,2,3\n");
    expect(outline.map((item) => item.text)).toEqual(["#1", "#2", "#3"]);
  });
});

describe("CSV viewer rendering (server-side)", () => {
  function renderViewer(content: string): string {
    return renderToStaticMarkup(
      createElement(CsvViewer, {
        content,
        documentId: "csv-doc",
        revision: 1,
        appearance: "light",
        onJumpToLine: () => {},
      }),
    );
  }

  it("renders only the visible window of a 100 000-row table", () => {
    const lines = ["c0,c1,c2,c3,c4"];
    for (let row = 0; row < 100_000; row += 1) {
      lines.push(`${row},a,b,c,d`);
    }
    const html = renderViewer(`${lines.join("\n")}\n`);

    // Header + windowed data rows + two spacer rows, never 100 001 rows.
    const rows = (html.match(/<tr/g) ?? []).length;
    expect(rows).toBeGreaterThan(1);
    expect(rows).toBeLessThan(80);
    expect(html).toContain("csv-table");
  });

  it("starts in source mode for a file above the size limit", () => {
    const huge = "x".repeat(2 * 1024 * 1024 + 1);
    const html = renderViewer(huge);

    expect(html).toContain("format-source");
    expect(html).not.toContain("csv-table");
  });

  it("escapes cell text instead of injecting markup", () => {
    const html = renderViewer('name,value\n"<script>alert(1)</script>",=1+1\n');

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("=1+1");
  });

  it("shows the formula note and source mode switch", () => {
    const html = renderViewer(example("telemetry.csv"));
    expect(html).toContain(t("viewer.csv.formulaNote"));
    expect(html).toContain(t("viewer.mode.source"));
    expect(html).toContain(t("viewer.csv.header"));
  });
});
