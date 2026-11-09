/**
 * RFC 4180 CSV parser.
 *
 * This is a real scanner rather than `split(",")`: quoted fields may contain
 * the delimiter, doubled quotes and line breaks, records may end with CRLF, LF
 * or a lone CR, and the first line may carry a UTF-8 BOM. Every cell is kept as
 * the exact string that was written, so `000123` stays `000123` and `1,25`
 * never becomes a number.
 *
 * The parser never throws: malformed input is reported through `diagnostics`
 * and the model is still built from everything that could be read.
 */

import type { Diagnostic, ParseResult } from "@/documents/types";
import { t } from "@/shared/i18n";

/** Delimiters the auto-detector and the manual switch understand. */
export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** True for a string that is one of the supported delimiters. */
export function isCsvDelimiter(value: string): value is CsvDelimiter {
  return CSV_DELIMITERS.some((delimiter) => delimiter === value);
}

export interface CsvDialect {
  delimiter: CsvDelimiter;
  /** `false` when the caller forced the delimiter instead of the detector. */
  detected: boolean;
}

/** One table column; the id is positional so duplicate headers stay distinct. */
export interface CsvColumn {
  /** Stable internal id (`col-1`, `col-2`, …); never derived from the header text. */
  id: string;
  /** 1-based position. */
  index: number;
  /** Header text exactly as written, or `""` when the column has no header. */
  label: string;
}

/** One logical record: a record may span several physical lines. */
export interface CsvRecord {
  /** 1-based logical record number in the file, header included. */
  index: number;
  /** 1-based physical line where the record starts. */
  line: number;
  /** 1-based physical line where the record ends (multiline quoted cells). */
  endLine: number;
  /** Cell values, unquoted but never coerced to numbers or dates. */
  cells: string[];
}

/** A record whose field count differs from the expected width. */
export interface CsvWidthIssue {
  /** 1-based logical record number, header included. */
  record: number;
  /** 1-based first physical line of the record. */
  lineFrom: number;
  /** 1-based last physical line of the record. */
  lineTo: number;
  /** Field count actually found. */
  count: number;
  /** Field count used as the expected width. */
  expected: number;
}

export interface CsvTable {
  dialect: CsvDialect;
  /** True when the first record was interpreted as a header. */
  hasHeader: boolean;
  /** Header cells, or `null` when the first record is data. */
  header: string[] | null;
  columns: CsvColumn[];
  /** Data records only; the header record is not repeated here. */
  records: CsvRecord[];
  /** Number of columns, taken from the widest record so no value is dropped. */
  width: number;
  /** Field count every record is compared against (header or first record). */
  expectedWidth: number;
  widthIssues: CsvWidthIssue[];
}

export interface CsvParseOptions {
  /** Force a delimiter. Omitted means auto-detect. */
  delimiter?: CsvDelimiter;
  /** Treat the first record as a header. Defaults to `true`. */
  header?: boolean;
}

/** How much text the delimiter detector reads before it decides. */
const DETECTION_SAMPLE_LENGTH = 16_384;
/** Upper bound on records sampled by the detector. */
const DETECTION_MAX_RECORDS = 200;

const BOM = 0xfeff;

interface RawRecord {
  cells: string[];
  line: number;
  endLine: number;
  from: number;
  to: number;
}

interface UnterminatedQuote {
  from: number;
  line: number;
}

interface ScanResult {
  records: RawRecord[];
  unterminatedQuote: UnterminatedQuote | null;
}

/**
 * Scan records with one delimiter.
 *
 * `maxRecords` lets the detector stop after a sample without copying the whole
 * file; the scanner always stops on a record boundary, so a partial record is
 * never reported.
 */
function scanRecords(
  source: string,
  delimiter: string,
  start: number,
  maxRecords = Number.POSITIVE_INFINITY,
): ScanResult {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let quotedField = false;
  let hasContent = false;
  let line = 1;
  let recordStartLine = 1;
  let recordStart = start;
  let quoteStart = -1;
  let quoteLine = 1;
  let unterminatedQuote: UnterminatedQuote | null = null;

  /** Close the current record. Returns true when the record budget is spent. */
  const finishRecord = (to: number): boolean => {
    cells.push(current);
    current = "";
    quotedField = false;
    const blank = cells.length === 1 && cells[0] === "" && !hasContent;
    if (!blank) {
      records.push({ cells, line: recordStartLine, endLine: line, from: recordStart, to });
    }
    cells = [];
    hasContent = false;
    return records.length >= maxRecords;
  };

  let index = start;
  while (index < source.length) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          // A doubled quote inside a quoted field is one literal quote.
          current += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      if (character === "\r") {
        // Line breaks inside quotes belong to the cell and are kept verbatim.
        if (source[index + 1] === "\n") {
          current += "\r\n";
          index += 2;
        } else {
          current += "\r";
          index += 1;
        }
        line += 1;
        continue;
      }
      if (character === "\n") {
        current += "\n";
        index += 1;
        line += 1;
        continue;
      }
      current += character;
      index += 1;
      continue;
    }

    if (character === delimiter) {
      cells.push(current);
      current = "";
      quotedField = false;
      hasContent = true;
      index += 1;
      continue;
    }

    if (character === '"') {
      // A quote only opens a quoted field at the very start of that field.
      if (current === "" && !quotedField) {
        inQuotes = true;
        quotedField = true;
        hasContent = true;
        quoteStart = index;
        quoteLine = line;
        index += 1;
        continue;
      }
      // A stray quote inside an unquoted field is data, not a delimiter.
      current += '"';
      hasContent = true;
      index += 1;
      continue;
    }

    if (character === "\r" || character === "\n") {
      const step = character === "\r" && source[index + 1] === "\n" ? 2 : 1;
      if (finishRecord(index)) {
        return { records, unterminatedQuote };
      }
      index += step;
      line += 1;
      recordStartLine = line;
      recordStart = index;
      continue;
    }

    current += character;
    hasContent = true;
    index += 1;
  }

  if (inQuotes) {
    unterminatedQuote = { from: quoteStart, line: quoteLine };
  }

  // Finish the trailing record: no terminator is required at end of input.
  if (hasContent || current !== "" || cells.length > 0 || quotedField) {
    cells.push(current);
    current = "";
    const blank = cells.length === 1 && cells[0] === "" && !hasContent && !quotedField;
    if (!blank) {
      records.push({ cells, line: recordStartLine, endLine: line, from: recordStart, to: source.length });
    }
  }

  return { records, unterminatedQuote };
}

/**
 * Pick the delimiter that yields the most consistent record width.
 *
 * Candidates are scored on how many sampled records share the modal width and
 * on that width itself; a candidate that never splits a record is ignored. The
 * detector reads a bounded sample, so a huge file is not scanned four times.
 */
export function detectDelimiter(source: string): CsvDelimiter {
  const start = source.charCodeAt(0) === BOM ? 1 : 0;
  const truncated = source.length - start > DETECTION_SAMPLE_LENGTH;
  const sample = truncated ? source.slice(start, start + DETECTION_SAMPLE_LENGTH) : source.slice(start);

  let bestDelimiter: CsvDelimiter = ",";
  let bestScore = -1;

  for (const delimiter of CSV_DELIMITERS) {
    const { records } = scanRecords(sample, delimiter, 0, DETECTION_MAX_RECORDS);
    const widths = records.map((record) => record.cells.length);
    // The sample may cut the last record in half, so it is not evidence.
    if (truncated && widths.length > 1) widths.pop();
    if (widths.length === 0) continue;

    let widest = 0;
    for (const width of widths) {
      if (width > widest) widest = width;
    }
    if (widest <= 1) continue;

    const frequencies = new Map<number, number>();
    for (const width of widths) {
      frequencies.set(width, (frequencies.get(width) ?? 0) + 1);
    }

    let modalWidth = 0;
    let modalCount = 0;
    for (const [width, count] of frequencies) {
      if (count > modalCount || (count === modalCount && width > modalWidth)) {
        modalWidth = width;
        modalCount = count;
      }
    }

    const score = (modalCount / widths.length) * 1_000_000 + modalWidth;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/** Parse CSV text into a table model plus every problem that was noticed. */
export function parseCsv(source: string, options: CsvParseOptions = {}): ParseResult<CsvTable> {
  const start = source.charCodeAt(0) === BOM ? 1 : 0;
  const forced = options.delimiter;
  const delimiter = forced ?? detectDelimiter(source);
  const wantsHeader = options.header ?? true;

  const { records: rawRecords, unterminatedQuote } = scanRecords(source, delimiter, start);

  const all: CsvRecord[] = rawRecords.map((record, position) => ({
    index: position + 1,
    line: record.line,
    endLine: record.endLine,
    cells: record.cells,
  }));

  const header = wantsHeader && all.length > 0 ? all[0].cells : null;
  const records = header ? all.slice(1) : all;

  let width = 0;
  for (const record of all) {
    if (record.cells.length > width) width = record.cells.length;
  }

  // The header (or the first record when the header is off) defines the shape
  // every other record is measured against.
  const expectedWidth = all.length > 0 ? all[0].cells.length : 0;

  const widthIssues: CsvWidthIssue[] = [];
  for (let position = 1; position < all.length; position += 1) {
    const record = all[position];
    if (record.cells.length !== expectedWidth) {
      widthIssues.push({
        record: record.index,
        lineFrom: record.line,
        lineTo: record.endLine,
        count: record.cells.length,
        expected: expectedWidth,
      });
    }
  }

  const columns: CsvColumn[] = [];
  for (let position = 0; position < width; position += 1) {
    columns.push({
      id: `col-${position + 1}`,
      index: position + 1,
      label: header && position < header.length ? header[position] : "",
    });
  }

  const diagnostics: Diagnostic[] = [];
  for (const issue of widthIssues) {
    const raw = rawRecords[issue.record - 1];
    diagnostics.push({
      severity: "warning",
      message: t("viewer.csv.ragged", {
        record: issue.record,
        count: issue.count,
        expected: issue.expected,
      }),
      from: raw.from,
      to: raw.to,
      line: issue.lineFrom,
      column: 1,
    });
  }
  if (unterminatedQuote) {
    diagnostics.push({
      severity: "warning",
      message: t("viewer.truncated"),
      from: unterminatedQuote.from,
      to: source.length,
      line: unterminatedQuote.line,
      column: 1,
    });
  }

  const model: CsvTable = {
    dialect: { delimiter, detected: forced === undefined },
    hasHeader: header !== null,
    header,
    columns,
    records,
    width,
    expectedWidth,
    widthIssues,
  };

  return { model, diagnostics };
}
