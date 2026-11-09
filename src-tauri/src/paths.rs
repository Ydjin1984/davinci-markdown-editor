//! Path handling shared by every command.
//!
//! Two rules drive this module:
//! 1. Markdown relative links resolve against the *document* directory, never
//!    against the process working directory.
//! 2. Anything the webview asks for is canonicalised and checked against an
//!    allow-list of roots before it is touched on disk.

use crate::error::{AppError, ErrorCode, Result};
use std::path::{Component, Path, PathBuf};

/// Markdown extensions this application claims to handle.
pub const MARKDOWN_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkdn", "mkd", "mdx", "mdtxt", "mdtext",
];

/// JSON documents, including the dialects that are JSON with a more specific
/// name. JSON-with-comments is deliberately not claimed: this editor has no
/// JSONC mode, so a `.jsonc` file opens as plain text rather than failing in
/// the strict JSON viewer.
pub const JSON_EXTENSIONS: &[&str] = &["json", "geojson", "webmanifest"];

/// Delimited text tables.
pub const CSV_EXTENSIONS: &[&str] = &["csv", "tsv"];

/// Line-oriented logs, including newline-delimited JSON.
pub const LOG_EXTENSIONS: &[&str] = &["log", "ndjson"];

/// XML documents and the XML dialects that carry their own extension.
pub const XML_EXTENSIONS: &[&str] = &["xml", "xsd", "xsl", "xslt", "svg", "rss", "atom", "plist"];

/// Plain text and the configuration formats that are read as plain text.
pub const TEXT_EXTENSIONS: &[&str] = &["txt", "text", "ini", "cfg", "conf", "yaml", "yml", "toml"];

/// Every extension this application claims to open as a text document.
///
/// Kept as one explicit list rather than a concatenation so the value that
/// crosses the IPC boundary is visible in one place; a unit test below proves
/// it covers every group and contains no duplicates.
pub const DOCUMENT_EXTENSIONS: &[&str] = &[
    // Markdown
    "md",
    "markdown",
    "mdown",
    "mkdn",
    "mkd",
    "mdx",
    "mdtxt",
    "mdtext",
    // JSON
    "json",
    "geojson",
    "webmanifest",
    // CSV
    "csv",
    "tsv",
    // LOG
    "log",
    "ndjson",
    // XML
    "xml",
    "xsd",
    "xsl",
    "xslt",
    "svg",
    "rss",
    "atom",
    "plist",
    // Text
    "txt",
    "text",
    "ini",
    "cfg",
    "conf",
    "yaml",
    "yml",
    "toml",
];

/// Resolve `.` / `..` and redundant separators without touching the filesystem.
///
/// `std::fs::canonicalize` is unusable for paths that do not exist yet
/// (Save As, "create file"), and on Windows it returns `\\?\` verbatim paths
/// which the webview cannot display.
pub fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    let mut depth: usize = 0;

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => {
                out.push(prefix.as_os_str());
            }
            Component::RootDir => {
                out.push(component.as_os_str());
                depth = 0;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if depth > 0 {
                    out.pop();
                    depth -= 1;
                } else {
                    // Keep leading `..` for relative paths rather than losing them.
                    out.push("..");
                }
            }
            Component::Normal(part) => {
                out.push(part);
                depth += 1;
            }
        }
    }

    if out.as_os_str().is_empty() {
        out.push(".");
    }
    out
}

/// Strip the Windows `\\?\` / `\\?\UNC\` verbatim prefix that `canonicalize`
/// adds, so paths round-trip cleanly through the UI and the title bar.
pub fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// Canonicalise a path that is expected to exist.
pub fn canonicalize_existing(path: &Path) -> Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(AppError::invalid_path(path, "empty path"));
    }
    let canonical = std::fs::canonicalize(path).map_err(|e| AppError::from_io(&e, path))?;
    Ok(strip_verbatim(&canonical))
}

/// Resolve a user-supplied path into an absolute, lexical form.
///
/// Relative input is resolved against `base` (the document directory or the
/// workspace root). Existence is not required.
pub fn resolve(base: Option<&Path>, candidate: &str) -> Result<PathBuf> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidPath, "The path is empty."));
    }

    if trimmed.contains('\0') {
        return Err(AppError::invalid_path(
            Path::new(trimmed),
            "path contains a NUL byte",
        ));
    }

    let raw = PathBuf::from(trimmed);
    let joined = if raw.is_absolute() {
        raw
    } else if let Some(base) = base {
        base.join(raw)
    } else {
        std::env::current_dir()
            .map_err(|e| AppError::from_io(&e, trimmed))?
            .join(raw)
    };

    Ok(normalize_lexically(&joined))
}

/// True when `child` is `root` itself or lives underneath it.
///
/// Both sides must already be canonical. The comparison is component-wise so
/// that `/home/user/docs-evil` is not treated as being inside `/home/user/docs`.
pub fn is_within(root: &Path, child: &Path) -> bool {
    let mut root_components = root.components();
    let mut child_components = child.components();

    loop {
        match (root_components.next(), child_components.next()) {
            (None, _) => return true,
            (Some(_), None) => return false,
            (Some(a), Some(b)) if a == b => continue,
            (Some(_), Some(_)) => return false,
        }
    }
}

pub fn extension_lowercase(path: &Path) -> Option<String> {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
}

pub fn is_markdown_path(path: &Path) -> bool {
    match extension_lowercase(path) {
        Some(ext) => MARKDOWN_EXTENSIONS.contains(&ext.as_str()),
        None => false,
    }
}

/// Kind of a document, using the same names as the frontend's `DocumentKind`.
///
/// Returns `"markdown" | "json" | "csv" | "log" | "xml"` for the claimed
/// groups and `"text"` for everything else — including an unknown extension or
/// no extension at all, because the editor can still open such a file as plain
/// text. Use [`is_document_path`] when the question is "does this application
/// claim this format" rather than "how should it be shown".
pub fn document_kind(path: &Path) -> &'static str {
    match extension_lowercase(path).as_deref() {
        Some(ext) if MARKDOWN_EXTENSIONS.contains(&ext) => "markdown",
        Some(ext) if JSON_EXTENSIONS.contains(&ext) => "json",
        Some(ext) if CSV_EXTENSIONS.contains(&ext) => "csv",
        Some(ext) if LOG_EXTENSIONS.contains(&ext) => "log",
        Some(ext) if XML_EXTENSIONS.contains(&ext) => "xml",
        _ => "text",
    }
}

/// True when the extension is one of the formats this application claims.
pub fn is_document_path(path: &Path) -> bool {
    match extension_lowercase(path) {
        Some(ext) => DOCUMENT_EXTENSIONS.contains(&ext.as_str()),
        None => false,
    }
}

/// Human-readable file name, falling back to the full path for odd roots.
pub fn file_name_or_path(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// MIME type used by the `mdasset://` protocol so the webview renders images.
pub fn mime_for_path(path: &Path) -> &'static str {
    match extension_lowercase(path).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") | Some("jpe") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("svg") | Some("svgz") => "image/svg+xml",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("pdf") => "application/pdf",
        Some("md") | Some("markdown") | Some("mdx") => "text/markdown; charset=utf-8",
        Some("json") | Some("geojson") | Some("webmanifest") => "application/json; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        Some("tsv") => "text/tab-separated-values; charset=utf-8",
        Some("xml") | Some("xsd") | Some("xsl") | Some("xslt") | Some("rss") | Some("atom") => {
            "application/xml; charset=utf-8"
        }
        Some("log") | Some("ndjson") => "text/plain; charset=utf-8",
        Some("txt") | Some("text") | Some("ini") | Some("cfg") | Some("conf") | Some("yaml")
        | Some("yml") | Some("toml") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Extensions the preview is allowed to inline through the asset protocol.
///
/// Everything else is refused so a document cannot turn the preview into a
/// generic file reader for `.ssh`, `.env` and friends.
pub fn is_inline_asset(path: &Path) -> bool {
    matches!(
        extension_lowercase(path).as_deref(),
        Some(
            "png"
                | "jpg"
                | "jpeg"
                | "jpe"
                | "gif"
                | "webp"
                | "avif"
                | "bmp"
                | "ico"
                | "svg"
                | "svgz"
                | "woff"
                | "woff2"
                | "ttf"
                | "otf"
                | "mp4"
                | "m4v"
                | "webm"
                | "mp3"
                | "ogg"
                | "wav"
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_dot_segments() {
        assert_eq!(
            normalize_lexically(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
    }

    #[test]
    fn normalize_keeps_leading_parent() {
        assert_eq!(
            normalize_lexically(Path::new("../a")),
            PathBuf::from("../a")
        );
    }

    #[test]
    fn within_is_component_wise() {
        assert!(is_within(
            Path::new("/home/u/docs"),
            Path::new("/home/u/docs/a/b.md")
        ));
        assert!(is_within(
            Path::new("/home/u/docs"),
            Path::new("/home/u/docs")
        ));
        assert!(!is_within(
            Path::new("/home/u/docs"),
            Path::new("/home/u/docs-evil/a.md")
        ));
        assert!(!is_within(Path::new("/home/u/docs"), Path::new("/home/u")));
    }

    #[test]
    fn markdown_detection_is_case_insensitive() {
        assert!(is_markdown_path(Path::new("README.MD")));
        assert!(is_markdown_path(Path::new("a.markdown")));
        assert!(!is_markdown_path(Path::new("a.txt")));
    }

    #[test]
    fn document_kind_covers_every_group() {
        for ext in MARKDOWN_EXTENSIONS {
            let name = format!("note.{ext}");
            assert_eq!(document_kind(Path::new(&name)), "markdown", "{name}");
        }
        for ext in JSON_EXTENSIONS {
            let name = format!("note.{ext}");
            assert_eq!(document_kind(Path::new(&name)), "json", "{name}");
        }
        for ext in CSV_EXTENSIONS {
            let name = format!("note.{ext}");
            assert_eq!(document_kind(Path::new(&name)), "csv", "{name}");
        }
        for ext in LOG_EXTENSIONS {
            let name = format!("note.{ext}");
            assert_eq!(document_kind(Path::new(&name)), "log", "{name}");
        }
        for ext in XML_EXTENSIONS {
            let name = format!("note.{ext}");
            assert_eq!(document_kind(Path::new(&name)), "xml", "{name}");
        }
        for ext in TEXT_EXTENSIONS {
            let name = format!("note.{ext}");
            assert_eq!(document_kind(Path::new(&name)), "text", "{name}");
        }
    }

    #[test]
    fn document_kind_is_case_insensitive() {
        assert_eq!(document_kind(Path::new("README.MD")), "markdown");
        assert_eq!(document_kind(Path::new("DATA.JSON")), "json");
        assert_eq!(document_kind(Path::new("table.Csv")), "csv");
        assert_eq!(document_kind(Path::new("app.LOG")), "log");
        assert_eq!(document_kind(Path::new("doc.XML")), "xml");
        assert_eq!(document_kind(Path::new("notes.Txt")), "text");
    }

    #[test]
    fn unknown_or_missing_extension_falls_back_to_text() {
        assert_eq!(document_kind(Path::new("archive.zip")), "text");
        assert_eq!(document_kind(Path::new("Makefile")), "text");
        assert!(!is_document_path(Path::new("archive.zip")));
        assert!(!is_document_path(Path::new("Makefile")));
        assert!(is_document_path(Path::new("data.json")));
        assert!(is_document_path(Path::new("README.MD")));
        assert!(is_document_path(Path::new("photo.SVG")));
    }

    #[test]
    fn document_extensions_are_unique_and_complete() {
        let mut seen = std::collections::BTreeSet::new();
        for ext in DOCUMENT_EXTENSIONS {
            assert!(seen.insert(*ext), "duplicate extension: {ext}");
            assert!(
                !ext.is_empty() && !ext.starts_with('.'),
                "malformed extension: {ext}"
            );
        }
        for group in [
            MARKDOWN_EXTENSIONS,
            JSON_EXTENSIONS,
            CSV_EXTENSIONS,
            LOG_EXTENSIONS,
            XML_EXTENSIONS,
            TEXT_EXTENSIONS,
        ] {
            for ext in group {
                assert!(
                    DOCUMENT_EXTENSIONS.contains(ext),
                    "missing from DOCUMENT_EXTENSIONS: {ext}"
                );
            }
        }
    }

    #[test]
    fn mime_types_cover_the_new_document_formats() {
        assert_eq!(
            mime_for_path(Path::new("data.json")),
            "application/json; charset=utf-8"
        );
        assert_eq!(
            mime_for_path(Path::new("table.csv")),
            "text/csv; charset=utf-8"
        );
        assert_eq!(
            mime_for_path(Path::new("doc.xml")),
            "application/xml; charset=utf-8"
        );
        assert_eq!(
            mime_for_path(Path::new("app.log")),
            "text/plain; charset=utf-8"
        );
        assert_eq!(
            mime_for_path(Path::new("notes.txt")),
            "text/plain; charset=utf-8"
        );
        // SVG keeps its image type so the preview can inline it as an image.
        assert_eq!(mime_for_path(Path::new("logo.svg")), "image/svg+xml");
        assert_eq!(
            mime_for_path(Path::new("blob.bin")),
            "application/octet-stream"
        );
    }

    #[test]
    fn strip_verbatim_handles_unc() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\C:\a\b")),
            PathBuf::from(r"C:\a\b")
        );
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\srv\share\a")),
            PathBuf::from(r"\\srv\share\a")
        );
        assert_eq!(
            strip_verbatim(Path::new("/plain/path")),
            PathBuf::from("/plain/path")
        );
    }
}
