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
        Some("md") | Some("markdown") => "text/markdown; charset=utf-8",
        Some("txt") | Some("log") => "text/plain; charset=utf-8",
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
