# Render upgrade — progress and contracts

Source of truth for the R0–R7 upgrade described in `DaVinci_Render_Kit/DaVinci_Render_TZ.md`.
Every stage updates the status table below; the contracts further down are what the
modules are written against.

## Status

| Stage | Scope | State |
|---|---|---|
| R0 | Baseline: HEAD pinned to `1b41003`, `npm ci`, `typecheck` and 127 tests green | done |
| R1 | Mermaid: DaVinci palette, template colours, queue, unique IDs, fit/manual zoom, fullscreen, source copy, export | done |
| R2 | Document kinds: registry, detection, CodeMirror languages, open/save, icons | done |
| R3 | JSON and XML: lossless source, tree, diagnostics, navigation | done |
| R4 | CSV: dialects, quoted/multiline cells, table view | done |
| R5 | LOG: profiles, levels, stack traces, filters | done |
| R6 | Icons and OS integration: sizes, UI, Windows associations | done |
| R7 | Final matrix, export, offline, regressions, release | in progress |

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
- Parser diagnostic messages themselves are technical English text; the surrounding UI is
  translated. Adding hundreds of per-error i18n keys was deliberately left out of this release.
- The MSI registers the associations with the application icon; the per-format `DefaultIcon`
  override is implemented in the NSIS hook only.
- Mermaid `classDef` written by a document wins over the app palette (by design, per the spec), so a
  template inserted while in the dark palette keeps its dark fills in the light theme.

## Verification log

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Format | `npm run format:check` | exit 0 |
| Frontend tests | `npm run test` | 20 files, 350 tests, exit 0 |
| Rust format | `cargo fmt -- --check` | exit 0 |
| Rust lint | `cargo clippy --all-targets -- -D warnings` | exit 0 |
| Rust tests | `cargo test` | 85 tests, exit 0 |
| Combined | `npm run verify` | exit 0 |
| Diagrams, real browser | Chrome CDP against `src/dev/renderLab.html` | 24 diagrams, 23 rendered, 1 expected local error; palette fills `#152d48/#60a5fa` etc.; 0 duplicate ids; 62/62 markers resolve; 0 clipped labels; fit→100%→200% = 527→527→1054 px with `transform: none`; standalone SVG opens over `file://` |

Browser verification notes live in the R1 report; the artefacts are temporary screenshots outside the
repository. The acceptance matrix in the TZ (M01–M07, J01–J03, C01–C04, L01–L02, X01–X02, F01–F03,
I01, P01) is covered by the automated suites plus the browser run, with the limitations above stated
rather than hidden.

### Independent review (task-7)

A second agent reviewed the whole diff against this contract. No blockers. Two major findings were
fixed before release:

1. The outline of a structured document was recomputed synchronously on every keystroke even with the
   panel hidden. It is now gated on `view.showOutline`, driven by a deferred value and debounced.
2. The diagram toolbar lacked fullscreen and "copy source". Both are implemented (a CSS overlay and a
   clipboard action), and the labels go through i18n.

The minor findings were also fixed: `kind` now follows a rename; JSON _Format_/_Minify_ are disabled
while the model is stale; `.jsonc` is no longer claimed (no JSONC mode exists, so it opens as text);
relative links open any supported format; `Ctrl+P` is Markdown-only like the menu commands; returning
from a structured viewer no longer hydrates diagrams twice; a plain text document gets an
"Interpret as" selector wired to the content sniffer; the browser-lab chunk list and the Mermaid
error line now go through i18n. Remaining accepted limitations are listed above.

### Packaging and install verification (local Windows)

The NSIS installer was built with the Rust/React release profile and installed over 0.2.2 on the
release machine:

| Check | Result |
|---|---|
| Silent install (`/S`, currentUser) | exit 0, no administrator rights, about 4 s |
| Installed version | `davinci-markdown.exe` 0.3.0, SHA-256 matches the executable inside the installer |
| Icon resources | 51 files under `icons\filetypes` (5 ICO with 7 frames each, 45 PNG 16–512, manifest) |
| ProgIDs | Five registered; `DefaultIcon` points at the per-format ICO, `shell\open\command` is quoted |
| Open with / Default apps | `OpenWithProgids` for 21 extensions (foreign entries untouched), `Applications`, `Capabilities`, `RegisteredApplications` |
| Association backups | The original defaults are snapshotted once and survive repeated installs, so uninstall can restore them |
| Shell launch | `ShellExecute` on a `.json` file started this application |
| Uninstall entry | `DisplayVersion=0.3.0`, icon, install location, publisher, help links |

The MSI was built and its file list inspected (same resources, same executable) but not installed.
Linux and macOS packages are built by CI on their own runners; they were not produced locally.
