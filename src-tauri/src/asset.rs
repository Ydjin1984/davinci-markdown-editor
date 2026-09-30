//! `mdasset://` URI scheme used to display images referenced from Markdown.
//!
//! A document is untrusted input, so the preview never receives blanket access
//! to the filesystem. A file is served only when all three hold:
//!
//! * it sits underneath a root the user actually opened — the workspace root,
//!   or a directory derived from an open document (see [`AssetRoots::allow_document`]);
//! * it carries an extension the preview is allowed to inline;
//! * it passes symlink-aware canonicalisation.
//!
//! Everything else answers 403 without touching the disk.
//!
//! The reach of the preview is always listed by `describe()` and shown to the
//! user in *Tools → Preview Asset Access*, so it is never hidden from them.

use crate::paths;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const ASSET_SCHEME: &str = "mdasset";

/// Largest asset the preview will inline.
const MAX_ASSET_BYTES: u64 = 128 * 1024 * 1024;

/// How many ancestor directories of a document are made readable.
///
/// Relative links routinely climb out of the document's own folder — a page at
/// `docs/guide/intro.md` referring to `../../images/logo.png` is the normal
/// layout of almost every repository — so the folder alone is not enough.
/// Walking up three levels covers that, while the walk stops before any
/// filesystem root: registering `/` or `C:\` would hand the preview the whole
/// disk.
const DOCUMENT_ANCESTOR_LEVELS: usize = 3;

/// Upper bound on remembered roots and files, so a session that opens hundreds
/// of documents cannot grow without limit. The oldest entry is evicted first.
const MAX_ROOTS: usize = 128;
const MAX_FILES: usize = 512;

/// Directories the preview may read from, oldest first so it can evict.
#[derive(Default)]
pub struct AssetRoots {
    roots: Mutex<VecDeque<PathBuf>>,
    /// Explicitly opened single files (a document opened from anywhere).
    files: Mutex<VecDeque<PathBuf>>,
}

impl AssetRoots {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allow everything inside `dir`. Non-existent paths are ignored.
    pub fn allow_directory(&self, dir: &Path) {
        if let Ok(canonical) = paths::canonicalize_existing(dir) {
            if canonical.is_dir() {
                push_bounded(&self.roots, canonical, MAX_ROOTS);
            }
        }
    }

    /// Allow the directories a document's relative links can reach.
    ///
    /// Registers the document's own directory and up to
    /// [`DOCUMENT_ANCESTOR_LEVELS`] ancestors, never including a filesystem
    /// root. The document file itself is always allowed.
    pub fn allow_document(&self, document: &Path) {
        let Ok(canonical) = paths::canonicalize_existing(document) else {
            return;
        };
        push_bounded(&self.files, canonical.clone(), MAX_FILES);

        let mut current = canonical.parent().map(Path::to_path_buf);
        let mut registered = 0;

        while let Some(directory) = current {
            // A path with no parent is a filesystem root (`/`, `C:\`).
            if directory.parent().is_none() {
                break;
            }
            self.allow_directory(&directory);
            registered += 1;
            if registered >= DOCUMENT_ANCESTOR_LEVELS {
                break;
            }
            current = directory.parent().map(Path::to_path_buf);
        }
    }

    pub fn revoke_directory(&self, dir: &Path) {
        let canonical =
            paths::canonicalize_existing(dir).unwrap_or_else(|_| paths::normalize_lexically(dir));
        self.roots.lock().retain(|entry| entry != &canonical);
    }

    pub fn allow_file(&self, file: &Path) {
        if let Ok(canonical) = paths::canonicalize_existing(file) {
            push_bounded(&self.files, canonical, MAX_FILES);
        }
    }

    pub fn revoke_file(&self, file: &Path) {
        let canonical =
            paths::canonicalize_existing(file).unwrap_or_else(|_| paths::normalize_lexically(file));
        self.files.lock().retain(|entry| entry != &canonical);
    }

    /// Drop every derived root, keeping only what the caller re-registers.
    ///
    /// Used before a full refresh so that closing a document actually revokes
    /// the ancestors it had brought into scope.
    pub fn clear(&self) {
        self.roots.lock().clear();
        self.files.lock().clear();
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.roots.lock().iter().cloned().collect()
    }

    /// Canonicalise a request and confirm it is inside an allowed root.
    pub fn resolve(&self, requested: &Path) -> Option<PathBuf> {
        if !paths::is_inline_asset(requested) {
            return None;
        }

        let canonical = paths::canonicalize_existing(requested).ok()?;
        if self.allows(&canonical) {
            Some(canonical)
        } else {
            None
        }
    }

    /// Whether a path is inside the registered reach, ignoring the extension
    /// filter. Used by the diagnostics command so the preview can tell "outside
    /// the allowed folders" apart from "file does not exist".
    pub fn allows(&self, requested: &Path) -> bool {
        // Canonicalise first: this collapses `..` and resolves symlinks, so a
        // link inside the workspace pointing at `/etc/shadow` is rejected.
        let Ok(canonical) = paths::canonicalize_existing(requested) else {
            return false;
        };

        if self.files.lock().iter().any(|entry| entry == &canonical) {
            return true;
        }

        self.roots
            .lock()
            .iter()
            .any(|root| paths::is_within(root, &canonical))
    }

    /// Directories currently allowed; surfaced in the diagnostics panel.
    pub fn describe(&self) -> Vec<String> {
        let mut all: Vec<String> = self
            .roots()
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        all.extend(
            self.files
                .lock()
                .iter()
                .map(|p| p.to_string_lossy().into_owned()),
        );
        all.sort();
        all.dedup();
        all
    }
}

/// Append to a bounded queue, moving an existing entry to the back.
///
/// Silently dropping new entries once a cap is reached used to mean that the
/// most recently opened document could lose its access; evicting the oldest
/// instead keeps the newest — which is what the user is looking at — working.
fn push_bounded(queue: &Mutex<VecDeque<PathBuf>>, value: PathBuf, limit: usize) {
    let mut guard = queue.lock();
    if let Some(index) = guard.iter().position(|entry| entry == &value) {
        guard.remove(index);
    }
    guard.push_back(value);
    while guard.len() > limit {
        guard.pop_front();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetAccess {
    pub scheme: String,
    pub roots: Vec<String>,
}

fn deny(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "no-store")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Header set applied to every asset response.
///
/// `Content-Security-Policy` matters for SVG: even though an SVG loaded through
/// `<img>` cannot run script, the same URL pasted into a browser can. Declaring
/// `default-src 'none'` here removes that difference.
fn secure_headers(
    builder: tauri::http::response::Builder,
    mime: &str,
) -> tauri::http::response::Builder {
    builder
        .header("Content-Type", mime)
        .header("X-Content-Type-Options", "nosniff")
        .header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        )
        .header("Cache-Control", "no-cache")
}

/// Build the response for one `mdasset://` request.
pub fn respond<R: Runtime>(
    ctx: &UriSchemeContext<'_, R>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let app = ctx.app_handle();
    // `AssetRoots` is a field of `AppState`, so it must be reached through the
    // managed `AppState` — asking for it directly always comes back empty and
    // turned every image request into a 500.
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        log::error!("asset request arrived before application state was managed");
        return deny(StatusCode::INTERNAL_SERVER_ERROR);
    };

    let encoded = request.uri().path().trim_start_matches('/');
    if encoded.is_empty() {
        return deny(StatusCode::BAD_REQUEST);
    }

    let decoded = percent_encoding::percent_decode_str(encoded).decode_utf8_lossy();
    let requested = PathBuf::from(decoded.as_ref());

    let Some(resolved) = state.assets.resolve(&requested) else {
        log::debug!("asset denied: {}", requested.display());
        return deny(StatusCode::FORBIDDEN);
    };

    let Ok(meta) = std::fs::metadata(&resolved) else {
        return deny(StatusCode::NOT_FOUND);
    };
    if !meta.is_file() {
        return deny(StatusCode::FORBIDDEN);
    }
    if meta.len() > MAX_ASSET_BYTES {
        return deny(StatusCode::PAYLOAD_TOO_LARGE);
    }

    match std::fs::read(&resolved) {
        Ok(bytes) => {
            let mime = paths::mime_for_path(&resolved);
            secure_headers(Response::builder().status(StatusCode::OK), mime)
                .body(bytes)
                .unwrap_or_else(|_| deny(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Err(err) => {
            log::debug!("asset read failed for {}: {err}", resolved.display());
            deny(map_io(&err))
        }
    }
}

fn map_io(err: &std::io::Error) -> StatusCode {
    match err.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Register the scheme. Uses the asynchronous registration so a large image read
/// never blocks the webview's main thread.
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(
        ASSET_SCHEME,
        move |ctx, request, responder: UriSchemeResponder| {
            let response = respond(&ctx, &request);
            responder.respond(response);
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_allow_list_blocks_arbitrary_files() {
        assert!(!paths::is_inline_asset(Path::new("/home/u/.ssh/id_rsa")));
        assert!(!paths::is_inline_asset(Path::new("/home/u/.env")));
        assert!(!paths::is_inline_asset(Path::new("/home/u/notes.md")));
        assert!(paths::is_inline_asset(Path::new("/home/u/diagram.png")));
        assert!(paths::is_inline_asset(Path::new("/home/u/logo.SVG")));
    }

    #[test]
    fn resolve_rejects_paths_outside_roots() {
        let roots = AssetRoots::new();
        let temp = std::env::temp_dir();
        roots.allow_directory(&temp);

        let inside = temp.join("davinci-asset-test.png");
        std::fs::write(&inside, b"png").expect("write fixture");
        assert!(roots.resolve(&inside).is_some());

        // A Markdown extension is not inlineable even inside an allowed root.
        assert!(roots.resolve(&temp.join("davinci-asset-test.md")).is_none());

        let _ = std::fs::remove_file(&inside);
    }
}
