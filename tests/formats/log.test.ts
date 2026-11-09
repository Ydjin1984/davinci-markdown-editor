/**
 * LOG parser, filters and outline.
 *
 * The contract is `DaVinci_Render_Kit/DaVinci_Render_TZ.md` §7 and
 * `examples/EXPECTED.md`: `application.log` is 8 physical lines and 6 events,
 * with INFO=3, WARN=1, ERROR=1, UNKNOWN=1; the ERROR owns lines 4–6; the word
 * ERROR inside an INFO message does not change the level.
 */

import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LogViewer } from "@/formats/log/LogViewer";
import { filterLogEvents } from "@/formats/log/filters";
import { logOutline } from "@/formats/log/outline";
import {
  countLogLevels,
  detectLogProfile,
  parseLog,
  type LogDocument,
  type LogParseOptions,
} from "@/formats/log/parse";

/** `DaVinci_Render_Kit/examples/application.log`, kept byte-exact. */
const APPLICATION_LOG = [
  "2026-11-09T08:10:00+05:00 INFO [app] Приложение запущено",
  "2026-11-09T08:10:01+05:00 INFO [parser] Открыт config.json",
  "2026-11-09T08:10:02+05:00 WARN [csv] Укажите разделитель",
  "2026-11-09T08:10:03+05:00 ERROR [xml] Ошибка структуры",
  "    at parseXml (parser.ts:42)",
  "    at openDocument (documents.ts:81)",
  "2026-11-09T08:10:04+05:00 INFO [search] Найдено слово ERROR",
  "Строка без известного формата",
].join("\n");

/** The same file lives outside the repository in the render kit. */
const KIT_EXAMPLE = new URL("../../../DaVinci_Render_Kit/examples/application.log", import.meta.url);
const kitExampleAvailable = existsSync(KIT_EXAMPLE);

function parse(source: string, options?: LogParseOptions): LogDocument {
  const model = parseLog(source, options).model;
  if (!model) throw new Error("parser returned no model");
  return model;
}

describe("LOG: application.log", () => {
  const model = parse(APPLICATION_LOG);

  it("chooses the ISO profile and reports it", () => {
    expect(model.profile).toBe("iso");
    expect(model.autoProfile).toBe("iso");
    expect(detectLogProfile(APPLICATION_LOG)).toBe("iso");
  });

  it("reads exactly 6 events from 8 physical lines", () => {
    expect(model.lineCount).toBe(8);
    expect(model.events).toHaveLength(6);
  });

  it("counts INFO=3, WARN=1, ERROR=1, UNKNOWN=1", () => {
    expect(model.counts).toEqual({ trace: 0, debug: 0, info: 3, warn: 1, error: 1, fatal: 0, unknown: 1 });
  });

  it("keeps the ERROR on physical lines 4–6 as one event", () => {
    const error = model.events[3];

    expect(error.level).toBe("error");
    expect(error.levelText).toBe("ERROR");
    expect(error.message).toBe("Ошибка структуры");
    expect(error.source).toBe("xml");
    expect(error.line).toBe(4);
    expect(error.endLine).toBe(6);
    expect(error.continuation.map((line) => line.text)).toEqual([
      "    at parseXml (parser.ts:42)",
      "    at openDocument (documents.ts:81)",
    ]);
    expect(error.continuation.map((line) => line.line)).toEqual([5, 6]);
  });

  it("maps the event range to the exact UTF-16 offsets", () => {
    const error = model.events[3];
    const start = APPLICATION_LOG.indexOf("2026-11-09T08:10:03");
    const end = APPLICATION_LOG.indexOf("(documents.ts:81)") + "(documents.ts:81)".length;

    expect(error.from).toBe(start);
    expect(error.to).toBe(end);
  });

  it("keeps an INFO message that mentions ERROR as INFO", () => {
    const info = model.events[4];

    expect(info.level).toBe("info");
    expect(info.levelText).toBe("INFO");
    expect(info.message).toBe("Найдено слово ERROR");
    expect(info.line).toBe(7);
    expect(info.endLine).toBe(7);
  });

  it("keeps the unrecognised line as one UNKNOWN event", () => {
    const unknown = model.events[5];

    expect(unknown.level).toBe("unknown");
    expect(unknown.message).toBe("Строка без известного формата");
    expect(unknown.time).toBeNull();
    expect(unknown.line).toBe(8);
    expect(unknown.endLine).toBe(8);
    expect(unknown.continuation).toEqual([]);
  });

  it("keeps times exactly as written, without shifting them to UTC", () => {
    expect(model.events.map((event) => event.time)).toEqual([
      "2026-11-09T08:10:00+05:00",
      "2026-11-09T08:10:01+05:00",
      "2026-11-09T08:10:02+05:00",
      "2026-11-09T08:10:03+05:00",
      "2026-11-09T08:10:04+05:00",
      null,
    ]);
  });

  it("splits bracketed sources out of the message", () => {
    expect(model.events.map((event) => event.source)).toEqual([
      "app",
      "parser",
      "csv",
      "xml",
      "search",
      null,
    ]);
    expect(model.sources).toEqual(["app", "parser", "csv", "xml", "search"]);
    expect(model.events[0].message).toBe("Приложение запущено");
  });

  it("parses the same file with CRLF line endings", () => {
    const crlf = parse(APPLICATION_LOG.replace(/\n/g, "\r\n"));

    expect(crlf.profile).toBe("iso");
    expect(crlf.events).toHaveLength(6);
    expect(crlf.events[0].message).toBe("Приложение запущено");
    expect(crlf.events[3].continuation[0].text).toBe("    at parseXml (parser.ts:42)");
  });

  it.skipIf(!kitExampleAvailable)("parses the kit example file from disk", () => {
    const source = readFileSync(KIT_EXAMPLE, "utf8");
    const fromDisk = parse(source);

    expect(fromDisk.events).toHaveLength(6);
    expect(fromDisk.counts).toEqual(model.counts);
    expect(fromDisk.events.map((event) => event.line)).toEqual([1, 2, 3, 4, 7, 8]);
  });
});

describe("LOG: profiles", () => {
  it("parses NDJSON with time/level/msg/logger", () => {
    const source = [
      '{"time":"2026-11-09T08:10:00Z","level":"info","msg":"started","logger":"app"}',
      '{"time":"2026-11-09T08:10:01Z","level":"warn","msg":"slow query","logger":"db"}',
      '{"time":"2026-11-09T08:10:02Z","level":"error","msg":"boom","logger":"db","stack":"Error: boom\\n    at parse (db.ts:12)"}',
    ].join("\n");

    const model = parse(source);

    expect(model.profile).toBe("ndjson");
    expect(model.events).toHaveLength(3);
    expect(model.counts).toEqual({ trace: 0, debug: 0, info: 1, warn: 1, error: 1, fatal: 0, unknown: 0 });
    expect(model.events[0].time).toBe("2026-11-09T08:10:00Z");
    expect(model.events[1].message).toBe("slow query");
    expect(model.events[1].source).toBe("db");
    expect(model.events[2].continuation.map((line) => line.text)).toEqual([
      "Error: boom",
      "    at parse (db.ts:12)",
    ]);
    expect(model.events[2].line).toBe(3);
    expect(model.events[2].endLine).toBe(3);
  });

  it("keeps broken NDJSON lines as UNKNOWN events instead of throwing", () => {
    const source = [
      '{"level":"info","msg":"ok1"}',
      '{"level":"warn","msg":"ok2"}',
      "not json",
      '{"level":"error", broken}',
    ].join("\n");

    const model = parse(source);

    expect(model.profile).toBe("ndjson");
    expect(model.events).toHaveLength(4);
    expect(model.events.map((event) => event.level)).toEqual(["info", "warn", "unknown", "unknown"]);
    expect(model.events[2].message).toBe("not json");
    expect(model.events[3].message).toBe('{"level":"error", broken}');
  });

  it("falls back to plain text when no profile is plausible", () => {
    const source = "первая строка\nвторая строка\n\nтретья";

    const model = parse(source);

    expect(model.profile).toBe("plain");
    expect(model.events).toHaveLength(3);
    expect(model.events.map((event) => event.level)).toEqual(["unknown", "unknown", "unknown"]);
    expect(model.events.map((event) => event.line)).toEqual([1, 2, 4]);
    expect(model.events.map((event) => event.message)).toEqual(["первая строка", "вторая строка", "третья"]);
  });

  it("honours an explicit plain profile for a structured file", () => {
    const model = parse(APPLICATION_LOG, { profile: "plain" });

    expect(model.profile).toBe("plain");
    expect(model.autoProfile).toBe("iso");
    // Every non-empty physical line survives as its own UNKNOWN event.
    expect(model.events).toHaveLength(8);
    expect(model.events.every((event) => event.level === "unknown")).toBe(true);
    expect(model.events[3].message).toBe("2026-11-09T08:10:03+05:00 ERROR [xml] Ошибка структуры");
  });

  it("treats an empty file as an empty document", () => {
    const model = parse("");

    expect(model.profile).toBe("plain");
    expect(model.events).toEqual([]);
    expect(model.lineCount).toBe(0);
    expect(model.counts).toEqual({ trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, unknown: 0 });
    expect(model.sources).toEqual([]);
  });

  it("parses lone CR line endings", () => {
    const model = parse("2026-11-09T08:10:00Z INFO one\r2026-11-09T08:10:01Z WARN two");

    expect(model.profile).toBe("iso");
    expect(model.events).toHaveLength(2);
    expect(model.events[1].message).toBe("two");
  });
});

describe("LOG: robustness", () => {
  it("never throws on hostile input", () => {
    expect(() => parseLog("a\u0000b\n" + "x".repeat(100_000))).not.toThrow();
    expect(() => parseLog("\uFEFF2026-11-09T08:10:00Z INFO bom")).not.toThrow();
    expect(() => parseLog("\n\n\n")).not.toThrow();
  });

  it("keeps an orphan continuation line as UNKNOWN", () => {
    const source = ["    at first (x.ts:1)", "2026-11-09T08:10:00Z INFO ok", "странная строка"].join("\n");

    const model = parse(source);

    expect(model.profile).toBe("iso");
    expect(model.events).toHaveLength(3);
    expect(model.events[0].level).toBe("unknown");
    expect(model.events[0].message).toBe("at first (x.ts:1)");
    expect(model.events[1].level).toBe("info");
    expect(model.events[2].level).toBe("unknown");
  });

  it("does not infer a level from a message word", () => {
    const model = parse("2026-11-09T08:10:00Z INFO FATAL ERROR detected");

    expect(model.events).toHaveLength(1);
    expect(model.events[0].level).toBe("info");
    expect(model.events[0].levelText).toBe("INFO");
  });

  it("counts levels of any event list", () => {
    const model = parse(APPLICATION_LOG);
    const infoOnly = filterLogEvents(model.events, { level: "info" });

    expect(countLogLevels(infoOnly.events)).toEqual({
      trace: 0,
      debug: 0,
      info: 3,
      warn: 0,
      error: 0,
      fatal: 0,
      unknown: 0,
    });
  });
});

describe("LOG: filters and counters", () => {
  const model = parse(APPLICATION_LOG);

  it("filters by level", () => {
    expect(filterLogEvents(model.events, { level: "error" }).shown).toBe(1);
    expect(filterLogEvents(model.events, { level: "info" }).shown).toBe(3);
    expect(filterLogEvents(model.events, { level: "fatal" }).shown).toBe(0);
  });

  it("reports counters before and after filtering", () => {
    const filtered = filterLogEvents(model.events, { level: "warn" });

    expect(filtered.total).toBe(6);
    expect(filtered.shown).toBe(1);
    expect(filtered.events[0].message).toBe("Укажите разделитель");
  });

  it("filters by source", () => {
    expect(filterLogEvents(model.events, { source: "csv" }).shown).toBe(1);
    expect(filterLogEvents(model.events, { source: "missing" }).shown).toBe(0);
    expect(filterLogEvents(model.events, { source: null }).shown).toBe(6);
  });

  it("filters by text without reading the level field", () => {
    // Only the INFO message mentions ERROR; the ERROR event does not.
    const byError = filterLogEvents(model.events, { text: "ERROR" });

    expect(byError.shown).toBe(1);
    expect(byError.events[0].level).toBe("info");
    expect(byError.events[0].line).toBe(7);

    expect(filterLogEvents(model.events, { text: "ошибка" }).shown).toBe(1);
    expect(filterLogEvents(model.events, { text: "открыт config" }).shown).toBe(1);
    expect(filterLogEvents(model.events, { text: "" }).shown).toBe(6);
  });

  it("filters inside a stack trace", () => {
    const filtered = filterLogEvents(model.events, { text: "documents.ts" });

    expect(filtered.shown).toBe(1);
    expect(filtered.events[0].level).toBe("error");
  });

  it("combines level, source and text", () => {
    expect(filterLogEvents(model.events, { level: "error", source: "xml" }).shown).toBe(1);
    expect(filterLogEvents(model.events, { level: "info", source: "xml" }).shown).toBe(0);
  });
});

describe("LOG: outline", () => {
  it("groups events by the minute and keeps their line numbers", () => {
    const outline = logOutline(APPLICATION_LOG);

    // The timed events share one minute; the line without a time falls back to
    // its level group instead of being dropped.
    expect(outline).toHaveLength(2);
    expect(outline[0].text).toBe("2026-11-09 08:10");
    expect(outline[0].line).toBe(1);
    expect(outline[0].children).toHaveLength(5);
    expect(outline[0].children.map((item) => item.line)).toEqual([1, 2, 3, 4, 7]);
    expect(outline[0].children[3].text).toBe("Ошибка структуры");
    expect(outline[1].children.map((item) => item.line)).toEqual([8]);
  });

  it("groups a plain file by level", () => {
    const outline = logOutline("строка один\nстрока два");

    expect(outline).toHaveLength(1);
    expect(outline[0].children.map((item) => item.line)).toEqual([1, 2]);
  });

  it("returns no outline for an empty file", () => {
    expect(logOutline("")).toEqual([]);
  });
});

describe("LOG: viewer", () => {
  it("renders the event table without a DOM", () => {
    const html = renderToString(
      createElement(LogViewer, {
        content: APPLICATION_LOG,
        documentId: "example.log",
        revision: 1,
        appearance: "light",
        onJumpToLine: () => {},
      }),
    );

    expect(html).toContain("log-event");
    expect(html).toContain("Приложение запущено");
    expect(html).toContain("Ошибка структуры");
    expect(html).toContain("INFO");
    // The stack trace stays collapsed until the user expands it.
    expect(html).not.toContain("at parseXml");
  });

  it("renders an empty document as an empty state", () => {
    const html = renderToString(
      createElement(LogViewer, {
        content: "",
        documentId: "empty.log",
        revision: 1,
        appearance: "dark",
        onJumpToLine: () => {},
      }),
    );

    expect(html).toContain("format-viewer-message");
    expect(html).not.toContain("log-event-row");
  });
});
