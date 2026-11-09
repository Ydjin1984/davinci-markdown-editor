/**
 * Content sniffing for documents whose extension says nothing useful.
 *
 * This never overrides a claimed extension: a `.md` file stays Markdown even
 * when it starts with `{`. It only helps when the extension is unknown (or
 * missing) and the user is about to choose a mode manually.
 */

import type { DocumentKind } from "./types";

/** First bytes inspected by the sniffer; enough for a file signature. */
const SAMPLE_LENGTH = 8192;

/**
 * Guess a structured kind from the text itself.
 *
 * Returns `null` when nothing convincing is found, which is the honest answer
 * for a log line that merely contains a brace.
 */
export function suggestKindFromContent(source: string): DocumentKind | null {
  const sample = source.slice(0, SAMPLE_LENGTH);
  const trimmed = sample.trimStart();
  if (!trimmed) return null;

  // NDJSON is a log format that happens to be JSON per line, so it has to be
  // recognised before the single-document JSON check.
  if (looksLikeNdjson(sample)) return "log";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return looksLikeJson(sample) ? "json" : null;
  }
  if (trimmed.startsWith("<?xml") || /^<[A-Za-z_:][^>]*>/.test(trimmed)) {
    return looksLikeXml(sample) ? "xml" : null;
  }
  if (looksLikeLog(sample)) return "log";
  if (looksLikeDelimited(sample)) return "csv";
  return null;
}

function looksLikeJson(sample: string): boolean {
  // Truncated samples are common for big files, so a strict parse would lie.
  // Balanced openers plus a colon or a closing bracket is enough evidence.
  const opens = (sample.match(/[{[]/g) ?? []).length;
  const closes = (sample.match(/[}\]]/g) ?? []).length;
  return opens > 0 && (closes > 0 || /"\s*:/.test(sample));
}

function looksLikeXml(sample: string): boolean {
  const tags = sample.match(/<\/?[A-Za-z_:][\w:.-]*(\s[^<>]*)?\/?>/g) ?? [];
  return tags.length >= 1 && sample.includes(">");
}

function looksLikeNdjson(sample: string): boolean {
  const lines = sample.split(/\r?\n/).filter((line) => line.trim().length > 0);
  // One object is simply a JSON document; NDJSON needs a line-per-record shape.
  if (lines.length < 2) return false;
  const objectLines = lines.filter((line) => {
    const text = line.trim();
    return text.startsWith("{") && text.endsWith("}");
  });
  return objectLines.length === lines.length && objectLines.length <= 200;
}

function looksLikeLog(sample: string): boolean {
  const lines = sample
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);
  if (lines.length === 0) return false;
  const stamped = lines.filter((line) =>
    /^\s*(\d{4}-\d{2}-\d{2}[T ]|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:)/.test(line),
  );
  return stamped.length >= Math.max(1, Math.ceil(lines.length * 0.6));
}

function looksLikeDelimited(sample: string): boolean {
  const lines = sample
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 8);
  if (lines.length < 2) return false;
  for (const delimiter of [",", ";", "\t", "|"]) {
    const counts = lines.map((line) => countUnquoted(line, delimiter));
    const first = counts[0]!;
    if (first === 0) continue;
    if (counts.every((count) => count === first)) return true;
  }
  return false;
}

function countUnquoted(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) count += 1;
  }
  return count;
}
