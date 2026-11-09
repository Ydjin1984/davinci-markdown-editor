# Render upgrade — progress and contracts

Source of truth for the R0–R7 upgrade described in `DaVinci_Render_Kit/DaVinci_Render_TZ.md`.
Every stage updates the status table below; the contracts further down are what the
modules are written against.

## Status

| Stage | Scope | State |
|---|---|---|
| R0 | Baseline: HEAD pinned to `1b41003`, `npm ci`, `typecheck` and 127 tests green | done |
| R1 | Mermaid: DaVinci palette, template colours, queue, unique IDs, fit/manual zoom, export | in progress |
| R2 | Document kinds: registry, detection, CodeMirror languages, open/save, icons | in progress |
| R3 | JSON and XML: lossless source, tree, diagnostics, navigation | in progress |
| R4 | CSV: dialects, quoted/multiline cells, table view | in progress |
| R5 | LOG: profiles, levels, stack traces, filters | in progress |
| R6 | Icons and OS integration: sizes, UI, Windows associations | pending |
| R7 | Final matrix, export, offline, regressions, release | pending |

## Baseline (R0)

- Repo: `https://github.com/Ydjin1984/davinci-markdown-editor`, HEAD `1b41003e227cdf5abc17684875618860698547e4`, version `0.2.2`.
- `npm ci` → 551 packages, exit 0.
- `npm run typecheck` → exit 0. `npm run test` → 127 tests, 9 files, pass.
- Installed build on this machine: `%LOCALAPPDATA%\DaVinci Markdown Editor`, 0.2.2.
- Toolchain: Node 24.22.1, npm 12.2.2, rustc 1.98.1, gh 2.97.0 (account `Ydjin1984`).

## Architecture contract

Raw text stays the only source of truth. A viewer derives a model; it never rewrites
the document. Saving writes the editor buffer byte-for-byte through the existing
`write_document` path, so all formats round-trip.

### Shared types — `src/documents/types.ts`

```ts
type DocumentKind = "markdown" | "json" | "csv" | "log" | "xml" | "text";
type PreviewMode = "rendered" | "tree" | "table" | "events" | "source";
interface Diagnostic { severity: "error" | "warning"; message: string; from: number; to: number; line: number; column: number }
interface ParseResult<M> { model: M | null; diagnostics: Diagnostic[] }
interface ViewerProps {
  content: string;
  documentId: string;
  revision: number;
  appearance: "light" | "dark";
  onJumpToLine: (line: number, column?: number) => void;
}
interface FormatModule { kind: DocumentKind; Viewer: ViewerComponent; outline?: (content: string) => OutlineItem[] }
```

Offsets are UTF-16 indices, lines and columns are 1-based, exactly as CodeMirror counts them.

### Registry — `src/documents/registry.ts`

`DOCUMENT_TYPES` describes each kind (extensions, MIME, editor language, preview modes,
Save As filter). `kindFromPath`, `descriptorFor`, `descriptorForExtension`,
`isStructuredPath`, `supportedExtensions`, `extensionsFor`, `isMarkdownPath`.

### Shared viewer chrome — `src/formats/shared/`

- `ViewerShell` — modes switch, toolbar slot, diagnostics strip, subheader, body.
- `ViewerMessage` — empty/error placeholder.
- `SourceView` — windowed read-only source with line numbers and click-to-line.
- `useParsed(source, parse)` — deferred parse that keeps the previous model while the new
  one is prepared, and reports `stale`.
- `viewer.css` — shared styles; a module adds only its own extra CSS.

### Format module layout (one directory per format)

```
src/formats/<kind>/
  parse.ts          // pure parser, no DOM, never throws
  <Kind>Viewer.tsx  // ViewerProps component built on ViewerShell
  outline.ts        // OutlineItem[] for the Outline panel
  styles.css        // module-specific styles only
  index.ts          // exports formatModule: FormatModule + re-exports the parser
```

Expected exports:

| Directory | Parser | Viewer | Outline | Module |
|---|---|---|---|---|
| `json` | `parseJson(source): ParseResult<JsonRoot>` | `JsonViewer` | `jsonOutline(source)` | `jsonModule` |
| `csv` | `parseCsv(source, options?): ParseResult<CsvTable>` | `CsvViewer` | `csvOutline(source)` | `csvModule` |
| `log` | `parseLog(source): ParseResult<LogDocument>` | `LogViewer` | `logOutline(source)` | `logModule` |
| `xml` | `parseXml(source): ParseResult<XmlDocument>` | `XmlViewer` | `xmlOutline(source)` | `xmlModule` |

Modules are collected in `src/formats/index.ts` (owned by the Lead):

```ts
export function formatModule(kind: DocumentKind): FormatModule | undefined
```

### Mermaid — `src/mermaid/`

- `theme.ts`: `PALETTE_VERSION`, `davinciTheme(appearance) -> { themeVariables, themeCSS }`,
  `contrastRatio(a, b)`.
- `queue.ts`: `enqueue(job)` serialises initialize+render; a cancelled job never publishes.
- `renderer.ts`: keeps `renderDiagram`, `cachedDiagram`, `clearDiagramCache`,
  `effectiveMermaidTheme`; `auto` resolves to the DaVinci palette.
- `hydrate.ts`: keeps `hydrateDiagrams`, `applyZoom`, `fitDiagram`, `diagramSvg`,
  `diagramSource`, `standaloneSvg`.
- `templates.ts`: keeps `DIAGRAM_TEMPLATES`, `fencedDiagram`.
- `src/dev/renderLab.html` + `src/dev/renderLab.tsx`: harness that renders every template
  and the kit examples for browser verification (not part of the production bundle).

### Editor

`src/editor/codemirror/setup.ts` gains a `language` compartment. Markdown commands are
attached only for Markdown documents; JSON/CSV/LOG/XML use their own grammar/highlighter.

### Rust

- `FileFilterKind` gains `Json`, `Csv`, `Log`, `Xml`, `Text`; open/save dialogs offer them.
- `paths.rs` gains `DOCUMENT_EXTENSIONS` and `document_kind(path)`; Markdown detection kept.
- `DirEntry`/`PathInfo` expose `kind`; workspace listing no longer hides non-Markdown files.
- `tauri.conf.json` declares five file associations; NSIS hooks register a per-format
  `DefaultIcon` ProgID and remove it on uninstall.

## Write scopes

| Owner | Scope |
|---|---|
| Lead | `src/documents/`, `src/formats/shared/`, `src/formats/index.ts`, `src/shared/`, `src/app/`, `src/editor/`, `src/preview/`, `src/tabs/`, `src/explorer/`, `src/outline/`, `src/styles/`, `src-tauri/`, `docs/`, `README.md`, versions, release |

| Module | Scope |
|---|---|
| Mermaid | `src/mermaid/`, `src/dev/renderLab.*`, `tests/mermaid/`, diagram block of `src/styles/markdown.css` |
| JSON | `src/formats/json/`, `tests/formats/json.test.ts` |
| CSV | `src/formats/csv/`, `tests/formats/csv.test.ts` |
| LOG | `src/formats/log/`, `tests/formats/log.test.ts` |
| XML | `src/formats/xml/`, `tests/formats/xml.test.ts` |

No module edits shared files. Missing i18n keys are reported to the Lead, never added.

## Commands

```
npm run typecheck
npm run lint
npm run test            # npx vitest run tests/formats/<kind>.test.ts while iterating
npm run fmt:rust:check
npm run test:rust
npm run app:build
```

## Known limitations (kept honest)

- macOS/Linux installers are built only by CI on their own runners; the local release
  carries the Windows artifacts plus checksums.
- Installers are not code-signed yet (same as 0.2.2).
- Follow mode for LOG files and `DOCTYPE` resolution are out of scope for this release.
