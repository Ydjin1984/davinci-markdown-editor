# Release checklist

Everything here is either impossible to automate or deliberately not automated. Work through it
on **clean machines**, not on a development box (spec §37.8).

Version: `______`  Release date: `______`  Release manager: `______`

---

## 1. Automated gate

Run `npm run verify` and confirm all of it is green before touching a clean machine.

- [ ] `npm run typecheck` — no TypeScript errors
- [ ] `npm run lint` — no ESLint errors
- [ ] `npm run test` — frontend suite passes
- [ ] `npm run fmt:rust:check` — Rust formatting clean
- [ ] `npm run lint:rust` — clippy with `-D warnings`
- [ ] `npm run test:rust` — Rust suite passes
- [ ] CI is green on the release commit for both `build-windows` and `build-linux`

---

## 2. Windows — clean install (spec §32)

Use a VM or a machine that has never had the application installed.

**Install**

- [ ] Installer runs without a SmartScreen block beyond the expected "unknown publisher" prompt
- [ ] Start Menu entry appears and launches the application
- [ ] An entry appears in *Apps & features* / *Programs and Features*
- [ ] The application icon is correct in the Start Menu, the taskbar and the window

**File association**

- [ ] `.md` appears in the right-click *Open with* list
- [ ] `.markdown` appears in the right-click *Open with* list
- [ ] The registered icon for `.md` is the application icon
- [ ] *Choose another app* → *Always use this app* works
- [ ] Double-clicking a `.md` file opens it in a tab
- [ ] Double-clicking a `.markdown` file opens it in a tab

**Paths**

- [ ] A path with spaces opens (`C:\My Documents\notes.md`)
- [ ] A path with Cyrillic characters opens (`C:\Мои документы\архитектура.md`)
- [ ] A path on a network share opens
- [ ] A file on a drive other than `C:` opens

**Multiple arguments**

- [ ] Selecting several `.md` files → *Open with* → all open as tabs
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

- [ ] Uninstalling removes the Start Menu entry and the *Apps & features* entry
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
- [ ] The `.md` entry appears in *Open With* in the file manager
- [ ] *Properties → Open With → Set as default* works

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
- [ ] *Copy SVG* puts SVG markup on the clipboard
- [ ] *Export SVG* writes a file that opens correctly in a browser and an image viewer
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
- [ ] The status bar switches between *Saved* and *Modified* correctly
- [ ] A CRLF file keeps CRLF after editing and saving
- [ ] A UTF-8 BOM file keeps its BOM
- [ ] Opening a 1 MB document is comfortable to edit
- [ ] Opening a 5 MB document does not hang the interface

**External changes**

- [ ] Editing the open file in another editor raises the change prompt
- [ ] *Reload* picks up the external content
- [ ] *Keep Local Changes* keeps the local text and allows the next save
- [ ] `Ctrl+S` in this application does **not** raise the prompt
- [ ] Deleting the file externally is reported rather than losing the buffer

**Workspace**

- [ ] *Open Folder* populates the explorer
- [ ] Expanding and collapsing directories works
- [ ] Creating, renaming and deleting files and folders works
- [ ] Deleting asks for confirmation and moves the item to the trash
- [ ] A file created outside the application appears in the tree

**Appearance and settings**

- [ ] Light, Dark and System themes all apply to the shell *and* the preview together
- [ ] Switching the OS theme with *System* selected updates the application
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
- [ ] With *Render raw HTML* off, `<details>` markup is dropped
- [ ] An image reference to `/etc/passwd` (or `C:\Windows\win.ini`) does not render
- [ ] An image reference to a file outside the open folder does not render
- [ ] *Tools → Preview Asset Access* lists only the folders actually opened
- [ ] Clicking an `https://` link opens the system browser, not an in-app window
- [ ] The webview devtools console shows no Content-Security-Policy violations

---

## 6. Artefacts

- [ ] Windows `.msi` and `.exe` produced
- [ ] Linux `.deb` produced (mandatory); `.rpm` and `.AppImage` produced if the environment allows
- [ ] `SHA256SUMS.txt` generated for every artefact
- [ ] Release notes written from merged changes since the previous tag
- [ ] Release published as a **draft** and reviewed before publishing
- [ ] Checksums published alongside the artefacts

## 7. Known limitations to state in the release notes

- [ ] Installers are unsigned; first launch shows a SmartScreen or Gatekeeper prompt
- [ ] macOS is not part of this release
- [ ] Drag & drop of images and paste-from-clipboard are not implemented
- [ ] PDF and PNG export are not implemented
- [ ] The external-change *Compare* view is not implemented
