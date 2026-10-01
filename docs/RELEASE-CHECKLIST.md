# Release checklist

Everything here is either impossible to automate or deliberately not automated. Work through it
on **clean machines**, not on a development box (spec §37.8).

Version: `______` Release date: `______` Release manager: `______`

---

## 1. Automated gate

Run `npm run verify` and confirm all of it is green before touching a clean machine.

- [ ] `npm run typecheck` — no TypeScript errors
- [ ] `npm run lint` — no ESLint errors
- [ ] `npm run test` — frontend suite passes
- [ ] `npm run fmt:rust:check` — Rust formatting clean
- [ ] `npm run lint:rust` — clippy with `-D warnings`
- [ ] `npm run test:rust` — Rust suite passes
- [ ] CI is green on the release commit: `build-windows`, `build-linux` and `build-macos`

---

## 2. Windows — clean install (spec §32)

Use a VM or a machine that has never had the application installed.

**Install**

- [ ] Installer runs without a SmartScreen block beyond the expected "unknown publisher" prompt
- [ ] Start Menu entry appears and launches the application
- [ ] An entry appears in _Apps & features_ / _Programs and Features_
- [ ] The application icon is correct in the Start Menu, the taskbar and the window

**File association**

- [ ] `.md` appears in the right-click _Open with_ list
- [ ] `.markdown` appears in the right-click _Open with_ list
- [ ] The registered icon for `.md` is the application icon
- [ ] _Choose another app_ → _Always use this app_ works
- [ ] Double-clicking a `.md` file opens it in a tab
- [ ] Double-clicking a `.markdown` file opens it in a tab

**Paths**

- [ ] A path with spaces opens (`C:\My Documents\notes.md`)
- [ ] A path with Cyrillic characters opens (`C:\Мои документы\архитектура.md`)
- [ ] A path on a network share opens
- [ ] A file on a drive other than `C:` opens

**Multiple arguments**

- [ ] Selecting several `.md` files → _Open with_ → all open as tabs
- [ ] `davinci-markdown.exe a.md b.md` from `cmd` opens both

**Single instance**

- [ ] With the application running, double-clicking a `.md` adds a tab to the **existing** window
- [ ] That window is brought to the foreground
- [ ] No second process is left behind (check Task Manager)
- [ ] The second invocation does not display an error dialog

**Errors**

- [ ] Opening a file locked exclusively by another process shows a dialog, not a crash
- [ ] Opening a file the user cannot read shows a permission message, not a crash
- [ ] Opening a deleted-between-click-and-open file shows a message, not a crash

**Uninstall and upgrade**

- [ ] Uninstalling removes the Start Menu entry and the _Apps & features_ entry
- [ ] Uninstalling leaves no orphaned ProgId registration in the registry
- [ ] Installing over an older version keeps `%APPDATA%\io.davinci.markdown\settings.json`

---

## 3. Linux — clean install (spec §32)

Test at minimum on Ubuntu/Debian (GNOME) and one of Kali, Fedora or Arch.

**Install**

- [ ] `sudo dpkg -i davinci-markdown_*.deb` (or `apt install ./…`) completes
- [ ] Dependencies resolve or are reported clearly
- [ ] The application appears in the desktop application menu
- [ ] The application icon renders at menu, window and taskbar sizes
- [ ] `davinci-markdown --version` works from a terminal

**Desktop integration**

- [ ] `/usr/share/applications/io.davinci.markdown.desktop` exists
- [ ] `/usr/share/mime/packages/io.davinci.markdown.mime.xml` exists
- [ ] `xdg-mime query default text/markdown` returns the desktop file after assignment
- [ ] `gio info file.md` reports `text/markdown`
- [ ] The `.md` entry appears in _Open With_ in the file manager
- [ ] _Properties → Open With → Set as default_ works

**File managers**

- [ ] GNOME Files / Nautilus: double-click opens the document
- [ ] Dolphin: double-click opens the document
- [ ] Thunar: double-click opens the document

**Paths**

- [ ] A path with spaces opens (`/home/u/My Documents/notes.md`)
- [ ] A path with Cyrillic characters opens (`/home/u/Документы/заметки.md`)
- [ ] A filename with `#`, `%` or `?` opens (URL-encoding round trip)

**Single instance**

- [ ] With the application running, double-clicking a `.md` adds a tab to the existing window
- [ ] `davinci-markdown a.md b.md` from a terminal opens both as tabs in the running instance
- [ ] The window is raised to the front

**Wayland / X11**

- [ ] Launches under a Wayland session
- [ ] Launches under an X11 session (`GDK_BACKEND=x11` for the Wayland case)

**Uninstall**

- [ ] `apt remove` removes the binary, the desktop file and the MIME registration
- [ ] `update-mime-database` and `update-desktop-database` are triggered by the package scripts
- [ ] Upgrading keeps `~/.config/io.davinci.markdown/settings.json`

**AppImage**

- [ ] Runs from a directory with no write permission (it mounts itself read-only)
- [ ] Double-clicking a `.md` opens it, which means the desktop entry's `%F` reached the app
- [ ] `--appimage-extract` shows a `usr/bin/davinci-markdown` and a desktop entry

---

## 3b. macOS — clean install

Builds are unsigned until a Developer ID certificate exists, so the first run always needs a
deliberate confirmation. This is the largest source of "it does not work" reports, so check it
explicitly rather than assuming.

**Install**

- [ ] The `.dmg` opens and shows the application beside an Applications shortcut
- [ ] Dragging it to Applications installs it
- [ ] First launch: right-click → _Open_ → _Open_ succeeds
- [ ] Double-clicking the app on a second attempt works without the prompt
- [ ] `xattr -d com.apple.quarantine` clears the quarantine flag if a user prefers that route
- [ ] The application appears in Launchpad with the right icon

**File association**

- [ ] `.md` shows the _Open With → DaVinci Markdown Editor_ entry in Finder
- [ ] _Get Info → Open with → Change All_ makes it the default
- [ ] Double-clicking a `.md` opens it in a tab
- [ ] The icon shown for `.md` files updates after the association is set

**Architecture**

- [ ] The Apple Silicon build runs natively (`Activity Monitor` → _Kind: Apple_)
- [ ] The Intel build runs under Rosetta on Apple Silicon, and natively on Intel hardware

**Paths and behaviour**

- [ ] A path with spaces opens
- [ ] A path with Cyrillic characters opens
- [ ] A file on an external volume opens
- [ ] With the application running, double-clicking a `.md` adds a tab to the existing window
- [ ] The window comes to the front
- [ ] `⌘Q` with unsaved changes asks whether to discard them — the application menu's Quit item
      runs the same flow as closing the window instead of terminating outright
- [ ] `⌘Q` with nothing unsaved exits immediately

**Uninstall**

- [ ] Dragging the application to the trash removes it
- [ ] `~/Library/Application Support/io.davinci.markdown/` holds the settings and survives

---

## 4. Feature smoke test

Open `tests/fixtures/Тестовый документ.md` from the repository — it covers most of this in one
document.

**Rendering**

- [ ] Headings, bold, italic, nested lists, blockquotes render
- [ ] Tables render with alignment
- [ ] Task list checkboxes reflect their checked state
- [ ] Strikethrough renders
- [ ] Footnotes render and their links jump to the note and back
- [ ] Relative images load (the image sits next to the document, not next to the executable)
- [ ] Inline and display math render
- [ ] A malformed formula is shown in red without breaking the document
- [ ] Code blocks are highlighted and the language label is correct
- [ ] The per-block Copy button copies the exact source

**Mermaid**

- [ ] Flowchart renders
- [ ] Sequence diagram renders
- [ ] Class, state, ER, Gantt, Git graph, mindmap, timeline and pie render
- [ ] Zoom in, zoom out, fit and reset work
- [ ] _Copy SVG_ puts SVG markup on the clipboard
- [ ] _Export SVG_ writes a file that opens correctly in a browser and an image viewer
- [ ] A diagram with a syntax error shows an error card **and keeps the source visible**
- [ ] The rest of the document still renders around a broken diagram
- [ ] A broken diagram does not freeze the interface

**Editor**

- [ ] Typing updates the preview with no perceptible lag
- [ ] Undo and redo work
- [ ] Multi-cursor editing works (`Ctrl`+click)
- [ ] Find and replace work, including the case-sensitivity toggle
- [ ] Code folding works on headings and code blocks
- [ ] `Ctrl+B` / `Ctrl+I` toggle bold and italic on the selection
- [ ] Undo history survives switching tabs and coming back

**Files**

- [ ] `Ctrl+S` saves; the dirty indicator clears
- [ ] The status bar switches between _Saved_ and _Modified_ correctly
- [ ] A CRLF file keeps CRLF after editing and saving
- [ ] A UTF-8 BOM file keeps its BOM
- [ ] Opening a 1 MB document is comfortable to edit
- [ ] Opening a 5 MB document does not hang the interface

**External changes**

- [ ] Editing the open file in another editor raises the change prompt
- [ ] _Reload_ picks up the external content
- [ ] _Keep Local Changes_ keeps the local text and allows the next save
- [ ] `Ctrl+S` in this application does **not** raise the prompt
- [ ] Deleting the file externally is reported rather than losing the buffer

**Workspace**

- [ ] _Open Folder_ populates the explorer
- [ ] Expanding and collapsing directories works
- [ ] Creating, renaming and deleting files and folders works
- [ ] Deleting asks for confirmation and moves the item to the trash
- [ ] A file created outside the application appears in the tree

**Appearance and settings**

- [ ] Light, Dark and System themes all apply to the shell _and_ the preview together
- [ ] Switching the OS theme with _System_ selected updates the application
- [ ] Editor font size, family, tab size and word wrap apply immediately
- [ ] Settings survive a restart
- [ ] `Ctrl+,` opens settings

**Session**

- [ ] Closing with several tabs open and reopening restores them
- [ ] The previously open folder is restored
- [ ] Closing with unsaved changes offers Save / Don't Save / Cancel
- [ ] Cancel keeps the window open

---

## 5. Security spot checks (spec §22, §32)

- [ ] A document containing `<script>alert(1)</script>` does not execute anything
- [ ] A document containing `<img src=x onerror="alert(1)">` does not execute anything
- [ ] A link with a `javascript:` target does nothing when clicked
- [ ] With _Render raw HTML_ off, `<details>` markup is dropped
- [ ] An image reference to `/etc/passwd` (or `C:\Windows\win.ini`) does not render
- [ ] An image reference to a file outside the open folder does not render
- [ ] _Tools → Preview Asset Access_ lists only the folders actually opened
- [ ] Clicking an `https://` link opens the system browser, not an in-app window
- [ ] The webview devtools console shows no Content-Security-Policy violations

---

## 6. Artefacts

Produced by the workflow on a version tag; it opens a **draft** release with all of them.

- [ ] Windows `.msi` and `.exe`
- [ ] Linux `.deb` (mandatory) and `.rpm`
- [ ] Linux `.AppImage` — large, because it carries its own WebKitGTK stack
- [ ] macOS `.dmg` for `aarch64` and `x64`
- [ ] The `.deb` desktop-integration check passed in CI, which is what proves the package
      actually claims `text/markdown` and passes `%F` through to the binary
- [ ] One merged `SHA256SUMS.txt` covering every artefact
- [ ] Release notes written from the merged changes since the previous tag
- [ ] The draft read through and then published

## 7. Known limitations to state in the release notes

- [ ] Installers are unsigned; first launch shows a SmartScreen or Gatekeeper prompt
- [ ] macOS builds are unsigned, so Gatekeeper requires a right-click → Open on first launch
- [ ] Drag & drop of images and paste-from-clipboard are not implemented
- [ ] PDF export produces a file through the system print dialog rather than silently
- [ ] The external-change _Compare_ view is not implemented
