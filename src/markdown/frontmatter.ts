/**
 * YAML (`---`) and TOML (`+++`) front matter.
 *
 * A document that opens with a metadata block is extremely common — Jekyll,
 * Hugo, Obsidian, GitHub Actions, and every agent skill. CommonMark has no
 * notion of it, so the closing delimiter is read as a setext heading underline
 * and the whole block is rendered as one enormous heading.
 *
 * The block is lifted out before parsing and rendered as its own card. The
 * Markdown that remains is padded with an equal number of blank lines so every
 * source position, and therefore every `data-line` marker and outline entry,
 * still points at the right line.
 */

/** `---` or `+++` opening, a body, then the same delimiter on its own line. */
const FRONT_MATTER = /^(?:\uFEFF)?(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/;

/** A flat `key: value` (YAML) or `key = value` (TOML) line. */
const ENTRY_LINE = /^([A-Za-z0-9_$][\w$.\- ]*)[ \t]*[:=][ \t]*(.*)$/;

/** A list item, which means the line above opens a sequence rather than a key. */
const LIST_ITEM = /^-[ \t]+\S/;

export interface FrontMatterEntry {
  key: string;
  value: string;
}

export interface FrontMatter {
  /** The delimiter that was used, so a reader can tell YAML from TOML. */
  delimiter: string;
  /** The block as written, without the delimiters. */
  raw: string;
  /** Key/value pairs, or `null` when the block is not a flat mapping. */
  entries: FrontMatterEntry[] | null;
  /** Blank lines to put in the block's place, keeping line numbers aligned. */
  padding: string;
  /** Everything after the block. */
  rest: string;
}

/**
 * Split a document into its front matter and the Markdown that follows.
 *
 * Returns `null` when the document does not open with a block. The pattern is
 * anchored to the start, so a thematic break further down is never mistaken for
 * front matter.
 */
export function parseFrontMatter(source: string): FrontMatter | null {
  const match = source.match(FRONT_MATTER);
  if (!match) return null;

  const whole = match[0];
  const delimiter = match[1] ?? "---";
  const body = match[2] ?? "";

  const newlines = (whole.match(/\n/g) ?? []).length;

  return {
    delimiter,
    raw: body,
    entries: parseEntries(body),
    padding: "\n".repeat(newlines),
    rest: source.slice(whole.length),
  };
}

/**
 * Read a flat `key: value` mapping.
 *
 * Deliberately not a YAML parser. Front matter is almost always a flat list of
 * scalars, and anything more involved — nested maps, anchors, lists of maps —
 * is shown verbatim rather than guessed at, which is also what a reader wants
 * to see when a document's metadata does not fit the simple shape.
 */
function parseEntries(body: string): FrontMatterEntry[] | null {
  const entries: FrontMatterEntry[] = [];
  let current: FrontMatterEntry | null = null;
  let isBlockScalar = false;

  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (current) current.value += "\n";
      continue;
    }

    if (/^[ \t]/.test(line) && current) {
      const text = line.trim();

      if (isBlockScalar) {
        current.value = `${current.value}${text}\n`;
        continue;
      }

      // An indented `key: value` or `- item` means the line above opened a map
      // or a sequence. Flattening that into `parent: "child: value"` would
      // misrepresent the document, so the whole block is shown verbatim.
      if (ENTRY_LINE.test(text) || LIST_ITEM.test(text)) return null;

      // Otherwise it is a wrapped plain scalar, which YAML joins with a space.
      current.value = `${current.value.trimEnd()} ${text}\n`;
      continue;
    }

    const match = line.match(ENTRY_LINE);
    if (!match) return null;

    const key = (match[1] ?? "").trim();
    const written = (match[2] ?? "").trim();
    isBlockScalar = written === "|" || written === ">" || written === "|-" || written === ">-";
    current = { key, value: isBlockScalar ? "" : written };
    entries.push(current);
  }

  if (entries.length === 0) return null;

  for (const entry of entries) {
    entry.value = entry.value.replace(/\n+$/, "").trimEnd();
  }

  return entries;
}

/** Escape a value for display; front matter is document-controlled text. */
function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render the block as a card for the preview.
 *
 * Built here rather than in a rehype plugin because the block never enters the
 * Markdown AST: letting it through would mean teaching the sanitiser about a
 * structure that has no reason to be sanitised in the first place. Every value
 * is escaped, so a document cannot inject markup through its metadata.
 */
export function renderFrontMatter(frontMatter: FrontMatter): string {
  const body = frontMatter.entries
    ? `<dl class="md-frontmatter-list">${frontMatter.entries
        .map(
          (entry) =>
            `<div class="md-frontmatter-entry"><dt>${escape(entry.key)}</dt>` +
            `<dd>${entry.value === "" ? "<em>empty</em>" : escape(entry.value)}</dd></div>`,
        )
        .join("")}</dl>`
    : `<pre class="md-frontmatter-raw">${escape(frontMatter.raw)}</pre>`;

  // Collapsed by default: metadata is reference material, not the document.
  return (
    `<details class="md-frontmatter" data-line="1">` +
    `<summary class="md-frontmatter-summary">Front matter</summary>` +
    body +
    `</details>`
  );
}
