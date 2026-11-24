# Linux desktop integration

These files describe how the application registers itself with the Linux desktop. They are used by
the Tauri bundler and referenced from `tauri.conf.json`.

## `desktop-entry.hbs`

The template for `/usr/share/applications/` — the application menu entry, and the thing that makes
*Open With* and *Set as default* work. Wired in through `bundle.linux.deb.desktopTemplate` and
`bundle.linux.rpm.desktopTemplate`, so both packages install the same entry.

Three details in it are load-bearing:

| Field | Why it matters |
|---|---|
| `Exec={{exec}} %F` | `%F` is where the file manager substitutes the documents you selected. Without it a double click opens an empty window, which is what Tauri's generated entry produces. |
| `MimeType={{mime_type}};` | `{{mime_type}}` is filled by the bundler from `bundle.fileAssociations` — all five families, in the order they are declared. The trailing semicolon is required by the desktop-entry list syntax. |
| `StartupWMClass={{exec}}` | Lets the taskbar associate a running window with this entry, so the right icon is shown instead of a generic one. |

`{{exec_arg}}` exists in newer tauri-cli releases, but the version this project pins
(`@tauri-apps/cli` 2.12.0) does not provide it, so `%F` is written out explicitly. Leaving the
placeholder in would render `Exec=davinci-markdown` with no field code and silently break opening a
file from the file manager.

The file name comes from the product name and therefore contains spaces
(`DaVinci Markdown Editor.desktop`). That is why `xdg-mime default` needs its argument quoted.

## `io.davinci.markdown.mime.xml`

A shared-mime-info package description mapping the extensions this application handles onto their
MIME types. Installed to `/usr/share/mime/packages/io.davinci.markdown.xml` through the `files` key
of the `deb` and `rpm` bundle settings.

`text/x-log` is used for `.log` and `.ndjson` instead of `text/plain`, so the association does not
compete for every `.txt` file.

**No maintainer script is needed.** Debian and Fedora both ship a file trigger on
`/usr/share/mime/packages/`, so the package manager runs `update-mime-database` automatically on
install and removal. Adding a `postInstallScript` that calls it by hand would duplicate work and
risk overriding Tauri's own maintainer scripts.

The bundler does **not** write this file from `bundle.fileAssociations`: it only feeds the desktop
entry's `MimeType` line. The XML is the sole registration of the globs, so the two have to be kept
in step by hand.

`text/markdown`, `application/json`, `text/csv`, `text/x-log` and `application/xml` are already
defined by the shared-mime-info database on current distributions, so this file only registers the
globs; it does not redefine the types.

## Rendering

`run()` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux before the webview is created. WebKitGTK's
DMA-BUF renderer cannot allocate GBM buffers on the NVIDIA proprietary driver and in some virtual or
remote sessions; the webview then never paints and the user sees a blank white window (WebKit bug
261874). The shared-memory path always paints. A user who wants the accelerated path back can export
`WEBKIT_DISABLE_DMABUF_RENDERER=0`, which the application respects because it only sets the variable
when it is absent.

## Verifying the association

```bash
# The type of a Markdown file
xdg-mime query filetype README.md                  # -> text/markdown

# Which application handles it
xdg-mime query default text/markdown

# Set this application as the default
xdg-mime default "DaVinci Markdown Editor.desktop" text/markdown

# What the file manager offers in "Open With"
gio info README.md | grep -i "content type"
```

After installing a package by hand rather than through the package manager, refresh the caches:

```bash
sudo update-mime-database /usr/share/mime
sudo update-desktop-database /usr/share/applications
```

## Tested window managers

GNOME Files (Nautilus) is the primary target. Dolphin and Thunar use the same freedesktop mechanism
and are on the release checklist to confirm — see
[`docs/RELEASE-CHECKLIST.md`](../../docs/RELEASE-CHECKLIST.md).
