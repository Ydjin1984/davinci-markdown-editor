<img src="src/assets/logo.png" alt="DaVinci Cyber Engineering" width="112" align="right" />

# DaVinci Markdown Editor

A cross-platform, natively integrated Markdown editor for **Windows** and **Linux** with
GitHub-compatible rendering, first-class Mermaid diagrams and a live preview.

Open a `.md` file in Explorer or your file manager and it appears in a tab — the same way any
other document does. No account, no cloud, no telemetry.

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB) ![React 19](https://img.shields.io/badge/React-19-61DAFB) ![Rust](https://img.shields.io/badge/Rust-stable-000000)

---

## Publisher

**DaVinci Cyber Engineering** — *Secure · Analyze · Engineer · Build*

| | |
|---|---|
| Website | <https://www.davinci-cyber-engineering.uz/> |
| Email | <info@davinci-cyber-engineering.uz> |
| Support the project | USDT · TRC20 · `TAnJB15jGXVtfKkwgs2pz5NFN5fN22ha41` |

Donations are voluntary and buy no support, features or licences. The same details, with a
scannable QR code, are in the application under *Help → About*.

---

## What it does

| Area | What you get |
|---|---|
| **Rendering** | CommonMark + GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks, footnotes |
| **Diagrams** | Mermaid: flowchart, sequence, class, state, ER, Gantt, Git graph, mindmap, timeline, pie — with zoom, fit and SVG export |
| **Code** | Shiki highlighting for every bundled grammar, copy button per block, theme matched to light/dark |
| **Math** | KaTeX inline (`$…$`) and display (`$$…$$`) with error isolation |
| **Editor** | CodeMirror 6: multi-cursor, code folding, bracket matching, find & replace, per-tab undo history |
| **Preview** | Debounced live update (~90 ms), editor↔preview scroll sync, anchor navigation |
| **Workspace** | Folder tree, file create/rename/delete (to the trash), outline panel, recent files |
| **Files** | UTF-8, UTF-8 BOM, UTF-16, legacy encodings; LF and CRLF preserved per file |
| **Safety** | Untrusted document model, sanitised HTML, capability-scoped Tauri, atomic writes, external-change detection |
| **OS** | `.md`/`.markdown` file associations, Open With, double-click, single-instance file forwarding |
| **Themes** | Light / Dark / System with GitHub-matching preview styles |

---

## Installing

Grab the installer for your platform from the
[releases page](https://github.com/Ydjin1984/davinci-markdown-editor/releases).

* **Windows** — `DaVinci Markdown Editor_<version>_x64-setup.exe` (NSIS) or the `.msi`.
* **Linux** — `.deb` (recommended), `.AppImage`, or `.rpm`.

Verify the download against `SHA256SUMS.txt` before installing. Builds are not code-signed yet,
so Windows SmartScreen will ask for confirmation on first launch.

### Making it the default Markdown application

* **Windows** — Right-click any `.md` file → *Open with* → *Choose another app* → pick
  *DaVinci Markdown Editor* → tick *Always use this app*.
* **Linux (GNOME)** — Right-click → *Properties* → *Open With*, or run
  `xdg-mime default io.davinci.markdown.desktop text/markdown`.

The installer registers the application as a handler for `text/markdown`; it does not silently
seize the association.

---

## Command line

```bash
davinci-markdown README.md                 # open a file
davinci-markdown README.md CHANGELOG.md    # open several
davinci-markdown ./docs/                   # open a folder as the workspace
davinci-markdown --version
davinci-markdown --help
```

If an instance is already running, the paths are forwarded to it as new tabs and the window is
raised — a second process is never started, and no file argument is dropped during the hand-off.

---

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Open file | `Ctrl+O` | `⌘+O` |
| Open folder | `Ctrl+Shift+O` | `⌘+Shift+O` |
| New file | `Ctrl+N` | `⌘+N` |
| Save | `Ctrl+S` | `⌘+S` |
| Save As | `Ctrl+Shift+S` | `⌘+Shift+S` |
| Close tab | `Ctrl+W` | `⌘+W` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `⌘+Tab` |
| Find | `Ctrl+F` | `⌘+F` |
| Replace | `Ctrl+H` | `⌘+H` |
| Bold / Italic | `Ctrl+B` / `Ctrl+I` | `⌘+B` / `⌘+I` |
| Inline code | `Ctrl+E` | `⌘+E` |
| Link / image | `Ctrl+K` / `Ctrl+Shift+K` | `⌘+K` / `⌘+Shift+K` |
| Heading 1–4 / clear | `Ctrl+Shift+1…4` / `Ctrl+Shift+0` | `⌘+Shift+1…4` / `⌘+Shift+0` |
| Bullet / ordered / task list | `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+9` | same with `⌘` |
| Toggle preview | `Ctrl+Shift+V` | `⌘+Shift+V` |
| Settings | `Ctrl+,` | `⌘+,` |

---

## Building from source

### Prerequisites

* **Node.js** ≥ 20.19 and npm
* **Rust** stable (1.82+)
* Platform toolchain:
  * **Windows** — Visual Studio Build Tools with the *Desktop development with C++* workload;
    WebView2 is preinstalled on Windows 10 (1803+) and Windows 11.
  * **Linux (Debian/Ubuntu)** —
    ```bash
    sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
      libayatana-appindicator3-dev librsvg2-dev patchelf build-essential
    ```
  * **Linux (Fedora/RHEL)** —
    ```bash
    sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
      librsvg2-devel patchelf
    ```
  * **Arch** — `sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg patchelf`

### Commands

```bash
npm install

npm run app:dev      # run the app with hot reload
npm run app:build    # produce release installers in src-tauri/target/release/bundle
```

### Verifying a checkout

```bash
npm run verify       # typecheck + lint + frontend tests + clippy + Rust tests
```

Individually:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest
npm run fmt:rust     # cargo fmt
npm run lint:rust    # cargo clippy --all-targets -- -D warnings
npm run test:rust    # cargo test
```

---

## Architecture

```
src/                      React + TypeScript front end
├── app/                  Shell: menu bar, status bar, dialogs, toasts, error boundary
├── editor/               CodeMirror 6: setup, themes, Markdown commands, cursor store
├── markdown/             Markdown engine — deliberately UI-free
│   ├── renderer/         unified pipeline + custom rehype plugins
│   ├── sanitize/         hast-util-sanitize policy
│   └── code/             Shiki highlighter
├── mermaid/              Lazy Mermaid renderer, caching, hydration
├── preview/              Preview pane, scroll sync, HTML export
├── tabs/                 Documents and tabs
├── explorer/             Workspace file tree
├── outline/              Heading outline
├── settings/             Settings store and dialog
├── shared/               IPC wrappers, types, i18n, utilities
└── styles/               Application chrome + Markdown rendering CSS

src-tauri/src/            Rust back end
├── lib.rs                Entry point, plugin and command registration
├── commands.rs           Every operation the webview may request
├── filesystem.rs         Encoding/EOL detection, atomic writes
├── workspace.rs          Directory listing and file operations
├── watcher.rs            Debounced filesystem watching
├── asset.rs              mdasset:// protocol with an access allow-list
├── settings.rs           settings.json / session.json
├── paths.rs              Lexical normalisation and containment checks
├── cli.rs                Argument parsing
├── state.rs              Shared application state
└── error.rs              Structured IPC errors
```

### Design decisions worth knowing

**The Markdown engine has no UI dependency.** `renderMarkdown(source, options)` takes a string and
returns HTML plus an outline. That keeps it testable in isolation and reusable by the feature set
still to come (PDF export, an internal viewer).

**Sanitisation is the security boundary, and its position in the pipeline is deliberate.**
Raw HTML is parsed and then forced through the schema; KaTeX, Shiki and Mermaid run *after* it,
producing markup from already-verified text. KaTeX runs with `trust: false`, so `\href`, `\url`
and `\htmlClass` stay inert.

**The preview cannot read your disk.** Images resolve through `mdasset://`, which serves only
files under a directory you actually opened (the workspace root, or the folder of an open
document) and only for extensions that are safe to inline. Symlinks are resolved before the
check, so a link pointing outside the workspace is refused. *Tools → Preview Asset Access* shows
the current allow-list.

**The webview has almost no Tauri permissions.** File dialogs, shell integration and filesystem
access are Rust commands with reviewed argument handling, not blanket plugin permissions. The
capability file grants only window and event access.

**Saving is atomic and never clobbers external edits.** Writes go to a sibling temp file, keep the
original permissions and are renamed into place. A save also carries the hash of the content the
editor loaded; if the file changed underneath, the write is refused and you are asked how to
proceed.

**The watcher recognises its own writes.** After a save, the resulting filesystem notification is
matched against the content just written and dropped, so no "changed on disk" prompt appears for
your own `Ctrl+S`.

**Per-tab undo history survives tab switches.** One CodeMirror view is reused and the whole
`EditorState` is swapped, which preserves history without keeping one view per tab.

**Diagrams are cached by content and theme.** Unchanged diagrams are re-inserted from cache on the
next keystroke, so a document with ten diagrams does not re-render ten times per edit. Every
render is generation-checked, so a slow async render can never overwrite a newer result.

**Mermaid runs with `securityLevel: 'strict'` and `htmlLabels: false`.** Strict mode sanitises the
generated SVG; SVG text labels instead of `foreignObject` mean an exported SVG opens correctly in
viewers that do not embed HTML.

### Bundle size note

Shiki ships 600+ grammars, and the build keeps them all available as lazily loaded chunks. This is
why `dist/` is ~17 MB. Only the ~13 common languages are loaded eagerly; the rest are fetched the
first time a fence uses them. If installer size matters more than grammar coverage, restrict
`EAGER_LANGUAGES` in `src/markdown/code/highlighter.ts` and map fewer entries in
`bundledLanguages`.

---

## Testing

```bash
npm run test        # 67 frontend tests
npm run test:rust   # 49 Rust tests (25 unit + 24 integration)
```

**Frontend** (`tests/`) covers CommonMark and GFM output, outline extraction, Mermaid fence
detection, code block handling, KaTeX error isolation, path resolution and the sanitisation policy
— the latter with explicit XSS vectors (`<script>`, `onerror`, `javascript:`, `data:text/html`,
`<iframe srcdoc>`, `<style>`, `<form>`, KaTeX `\href`).

**Rust unit tests** (`src-tauri/src/**`, running under `cargo test --lib`) cover path normalisation
and containment, CLI parsing, encoding and EOL helpers, binary sniffing, BOM handling, settings
forward-compatibility and workspace name validation.

**Rust integration tests** (`src-tauri/tests/`) exercise the real filesystem: UTF-8, BOM, CRLF and
`windows-1251` round trips, binary refusal, atomic replacement leaving no temporary file behind,
concurrent writers producing a complete file, `expectedHash` conflict detection, Unicode and
spaced paths, and read-only detection.

Cargo requires integration tests to live under `src-tauri/tests/`, so the repository has two test
roots: the spec's `tests/` layout for the frontend suite, and Cargo's convention for Rust.

### Manual checks still required before a release

These cannot be automated in CI and belong on the release checklist (spec §30, §32):

- [ ] Clean Windows: install → *Open With* → set as default → double-click a `.md`
- [ ] Clean Linux: `.deb` install → application menu → MIME association → double-click a `.md`
- [ ] A path with spaces and Cyrillic characters opens from the file manager
- [ ] Double-click while an instance is running adds a tab to that window
- [ ] Selecting several `.md` files opens all of them
- [ ] Upgrade over an existing install keeps `settings.json`

---

## Settings locations

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\io.davinci.markdown\` |
| Linux | `~/.config/io.davinci.markdown/` |

`settings.json` and `session.json` live there. Both are written atomically, and a file that cannot
be parsed is preserved as `settings.json.corrupt-<timestamp>` rather than silently overwritten.

---

## Scope

**In this release** — everything described above.

**Deliberately not included** (spec §36): macOS is optional and untested here; no cloud sync,
accounts, collaboration, AI assistant, Git client, plugin marketplace, WYSIWYG mode, mobile
version, embedded browser or telemetry. Telemetry is absent by construction; the settings flag
exists only to make that explicit.

**Known follow-ups** — drag & drop of images into a document, paste-image-from-clipboard, PDF and
PNG export, a side-by-side external-change comparison view, and macOS packaging (spec §15, §17,
§24, §34 Phase 8).

---

## Licence

MIT — see [LICENSE](LICENSE).
