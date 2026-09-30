# Linux desktop integration

These files describe how the application registers itself with the Linux desktop. They are
installed by the Tauri bundler and referenced from `tauri.conf.json`.

## `io.davinci.markdown.mime.xml`

A shared-mime-info package description. It maps the Markdown file extensions onto `text/markdown`.

Installed to `/usr/share/mime/packages/io.davinci.markdown.xml` through the `files` key of the
`deb` and `rpm` bundle settings.

**No maintainer script is needed.** Debian and Fedora both ship a dpkg/rpm file trigger on
`/usr/share/mime/packages/`, so the package manager runs `update-mime-database` automatically on
install and on removal. Adding a `postInstallScript` that calls it by hand would only duplicate
work and risk overriding Tauri's own maintainer scripts.

`text/markdown` is already defined by the shared-mime-info database on current distributions, so
this file only registers the globs; it does not redefine the type.

## `davinci-markdown.desktop`

A reference copy of the desktop entry, kept in the repository so the intended behaviour is
reviewable and can be installed by hand when packaging outside Tauri.

The bundler generates its own desktop file from `bundle.fileAssociations` and the `bundle.linux`
settings in `tauri.conf.json`. The generated file is authoritative; this copy documents the target
state and is what to reach for if a distribution needs the entry supplied explicitly.

Key fields:

| Field | Why it matters |
|---|---|
| `Exec=davinci-markdown %F` | `%F` passes every selected file, so multi-select works |
| `MimeType=text/markdown;` | Makes the entry appear in *Open With* and allows setting it as default |
| `StartupWMClass=io.davinci.markdown` | Lets the taskbar associate the window with the launcher icon |
| `TryExec=davinci-markdown` | Hides the entry if the binary is missing instead of showing a broken launcher |

## Verifying the association

```bash
# The type of a Markdown file
xdg-mime query filetype README.md                  # -> text/markdown

# Which application handles it
xdg-mime query default text/markdown

# Set this application as the default
xdg-mime default io.davinci.markdown.desktop text/markdown

# What the file manager will offer in "Open With"
gio info README.md | grep -i "standard::icon\|content type"
```

After installing a package by hand (rather than through the package manager), refresh the caches:

```bash
sudo update-mime-database /usr/share/mime
sudo update-desktop-database /usr/share/applications
```

## Tested window managers

GNOME Files (Nautilus) is the primary target. Dolphin and Thunar are expected to work through the
same freedesktop mechanism and are on the release checklist to confirm — see
[`docs/RELEASE-CHECKLIST.md`](../../docs/RELEASE-CHECKLIST.md).
