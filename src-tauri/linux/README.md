# Linux desktop integration

These files describe how the application registers itself with the Linux desktop. They are used by
the Tauri bundler and referenced from `tauri.conf.json`.

## `desktop-entry.hbs`

The template for `/usr/share/applications/` — the application menu entry, and the thing that makes
*Open With* and *Set as default* work. Wired in through `bundle.linux.deb.desktopTemplate` and
`bundle.linux.rpm.desktopTemplate`, so both packages install the same entry.

Two details in it are load-bearing:

| Field | Why it matters |
|---|---|
| `Exec={{exec}} %F` | `%F` is where the file manager substitutes the documents you selected. Without it a double click opens an empty window, which is what Tauri's generated entry produces. |
| `StartupWMClass={{exec}}` | Lets the taskbar associate a running window with this entry, so the right icon is shown instead of a generic one. |

`MimeType=text/markdown;` has no Handlebars variable and mirrors `bundle.fileAssociations` in
`tauri.conf.json`; the two have to be kept in step by hand.

The file name comes from the product name and therefore contains spaces
(`DaVinci Markdown Editor.desktop`). That is why `xdg-mime default` needs its argument quoted.

## `io.davinci.markdown.mime.xml`

A shared-mime-info package description mapping the Markdown extensions onto `text/markdown`.
Installed to `/usr/share/mime/packages/io.davinci.markdown.xml` through the `files` key of the
`deb` and `rpm` bundle settings.

**No maintainer script is needed.** Debian and Fedora both ship a file trigger on
`/usr/share/mime/packages/`, so the package manager runs `update-mime-database` automatically on
install and removal. Adding a `postInstallScript` that calls it by hand would duplicate work and
risk overriding Tauri's own maintainer scripts.

`text/markdown` is already defined by the shared-mime-info database on current distributions, so
this file only registers the globs; it does not redefine the type.

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
