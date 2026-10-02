//! Android bridge: document URIs and printing.
//!
//! On Android a document is a `content://` URI handed over by the system file
//! picker rather than a filesystem path, and printing goes through the
//! platform's own `PrintManager` instead of `window.print()`. Both live in a
//! small Kotlin plugin
//! (`gen/android/app/src/main/java/io/davinci/markdown/MobilePlugin.kt`);
//! this module registers it and wraps its commands so the rest of the Rust side
//! only ever sees ordinary functions.
//!
//! A `content://` string is opaque: it must never be passed to [`std::fs`] or
//! resolved as a path. Every entry point below takes the URI as-is and lets the
//! Kotlin side talk to `ContentResolver`.
//!
//! The desktop build keeps the same module so call sites stay free of
//! platform branches; without a bridge every entry point reports
//! `unsupported`, which is exactly true there — a `content://` URI can only
//! come from the Android picker.

use crate::error::{AppError, ErrorCode, Result};
use crate::filesystem::TextDocument;
use serde::Deserialize;

/// Name the plugin is registered under on both sides.
pub const PLUGIN_NAME: &str = "davinci-mobile";

/// True for a document handled by the system file picker.
///
/// Such a "path" never touches the disk API: it is read and written through
/// [`read_document`] and [`write_document`].
pub fn is_content_uri(path: &str) -> bool {
    path.starts_with("content://")
}

/// What a picker hands back: the URI to remember plus a display name.
#[allow(dead_code)] // Read on Android; the desktop build only round-trips it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedDocument {
    pub uri: String,
    pub name: String,
}

#[cfg(not(target_os = "android"))]
fn unsupported<T>() -> Result<T> {
    Err(AppError::new(
        ErrorCode::Unsupported,
        "System file pickers are only used on Android; this build opens files by path.",
    ))
}

// ---------------------------------------------------------------------------
// Android implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
mod platform {
    use super::*;
    use crate::filesystem;
    use serde::Serialize;
    use std::sync::OnceLock;

    /// Kotlin class and module registered with the Android plugin manager. The
    /// identifier is the application id from `tauri.conf.json`.
    const PLUGIN_IDENTIFIER: &str = "io.davinci.markdown";
    const PLUGIN_CLASS: &str = "MobilePlugin";

    static HANDLE: OnceLock<tauri::plugin::PluginHandle<tauri::Wry>> = OnceLock::new();

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MobileReadResult {
        content: String,
        name: String,
        size: u64,
        modified_ms: u64,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MobileWriteResult {
        name: String,
        size: u64,
        modified_ms: u64,
    }

    #[derive(Serialize)]
    struct UriArg<'a> {
        uri: &'a str,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct WriteArg<'a> {
        uri: &'a str,
        content: &'a str,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CreateArg<'a> {
        name: &'a str,
        mime_type: &'a str,
        content: &'a str,
    }

    /// The plugin registered in `lib.rs`.
    pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry, ()> {
        tauri::plugin::Builder::<tauri::Wry, ()>::new(PLUGIN_NAME)
            .setup(|_app, api| {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS)?;
                // A second registration can only follow a duplicate plugin
                // entry; the first handle stays the live one either way.
                let _ = HANDLE.set(handle);
                Ok(())
            })
            .build()
    }

    fn handle() -> Result<&'static tauri::plugin::PluginHandle<tauri::Wry>> {
        HANDLE.get().ok_or_else(|| {
            AppError::new(
                ErrorCode::Unsupported,
                "The Android file bridge is not available.",
            )
        })
    }

    /// Turn a JNI-level failure into an application error, keeping the Kotlin
    /// message: the platform's own wording ("no permission", "the file is
    /// gone") is more useful than anything invented here.
    fn bridge_error(message: &str, error: impl std::fmt::Display) -> AppError {
        AppError::new(ErrorCode::Io, message).with_detail(error.to_string())
    }

    /// Read a picked document into the same shape a disk read produces.
    pub fn read_document(uri: &str) -> Result<TextDocument> {
        let raw = handle()?
            .run_mobile_plugin::<MobileReadResult>("readText", UriArg { uri })
            .map_err(|error| bridge_error("The document could not be read.", error))?;

        // The editor works on LF internally, exactly like the desktop path.
        let content = filesystem::normalize_newlines(&raw.content);
        let eol = filesystem::detect_eol(&raw.content).to_string();

        Ok(TextDocument {
            path: uri.to_string(),
            name: raw.name,
            // A URI has no directory of its own; relative links to sibling
            // files cannot be resolved through the picker.
            dir: String::new(),
            hash: filesystem::hash_text(&content),
            line_count: content.lines().count().max(1),
            encoding: "UTF-8".to_string(),
            eol,
            bom: false,
            size: raw.size,
            modified_ms: raw.modified_ms,
            read_only: false,
            content,
        })
    }

    /// Write a document back to the URI it came from.
    pub fn write_document(uri: &str, content: &str, eol: &str) -> Result<TextDocument> {
        let text = filesystem::apply_eol(content, eol);
        let written = handle()?
            .run_mobile_plugin::<MobileWriteResult>(
                "writeText",
                WriteArg {
                    uri,
                    content: &text,
                },
            )
            .map_err(|error| bridge_error("The document could not be saved.", error))?;

        Ok(TextDocument {
            path: uri.to_string(),
            name: written.name,
            dir: String::new(),
            hash: filesystem::hash_text(content),
            line_count: content.lines().count().max(1),
            encoding: "UTF-8".to_string(),
            eol: eol.to_string(),
            bom: false,
            size: written.size,
            modified_ms: written.modified_ms,
            read_only: false,
            content: content.to_string(),
        })
    }

    /// Write an exported artefact (HTML) to an already chosen URI.
    pub fn write_export(uri: &str, content: &str) -> Result<()> {
        handle()?
            .run_mobile_plugin::<MobileWriteResult>("writeText", WriteArg { uri, content })
            .map(|_| ())
            .map_err(|error| bridge_error("The export could not be written.", error))
    }

    /// Ask the system for a document to open.
    pub fn pick_document() -> Result<Option<PickedDocument>> {
        handle()?
            .run_mobile_plugin::<Option<PickedDocument>>("pickDocument", ())
            .map_err(|error| bridge_error("The file picker could not be opened.", error))
    }

    /// Ask the system where to create a file. The returned URI is empty until
    /// the caller writes to it — the same two-step flow the desktop dialog
    /// uses, so the export and "save as" paths stay identical.
    pub fn pick_save_file(name: &str, mime_type: &str) -> Result<Option<PickedDocument>> {
        handle()?
            .run_mobile_plugin::<Option<PickedDocument>>(
                "pickSaveFile",
                CreateArg {
                    name,
                    mime_type,
                    content: "",
                },
            )
            .map_err(|error| bridge_error("The save dialog could not be opened.", error))
    }

    /// The document the system asked us to open at launch, if any. Drained
    /// once so a stale URI cannot be reopened behind the user's back.
    pub fn take_launch_uri() -> Result<Option<PickedDocument>> {
        handle()?
            .run_mobile_plugin::<Option<PickedDocument>>("takeLaunchUri", ())
            .map_err(|error| bridge_error("The file could not be opened.", error))
    }

    /// Open the system print dialog, where "Save as PDF" lives.
    pub fn print_page() -> Result<()> {
        handle()?
            .run_mobile_plugin::<serde_json::Value>("printPage", ())
            .map(|_| ())
            .map_err(|error| bridge_error("The print dialog could not be opened.", error))
    }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
pub use platform::plugin;

#[cfg(target_os = "android")]
pub use platform::{
    pick_document, pick_save_file, print_page, read_document, take_launch_uri, write_document,
    write_export,
};

#[cfg(not(target_os = "android"))]
pub fn read_document(uri: &str) -> Result<TextDocument> {
    let _ = uri;
    unsupported()
}

#[cfg(not(target_os = "android"))]
pub fn write_document(uri: &str, content: &str, eol: &str) -> Result<TextDocument> {
    let _ = (uri, content, eol);
    unsupported()
}

#[cfg(not(target_os = "android"))]
pub fn write_export(uri: &str, content: &str) -> Result<()> {
    let _ = (uri, content);
    unsupported()
}

#[cfg(not(target_os = "android"))]
pub fn pick_document() -> Result<Option<PickedDocument>> {
    unsupported()
}

#[cfg(not(target_os = "android"))]
pub fn pick_save_file(name: &str, mime_type: &str) -> Result<Option<PickedDocument>> {
    let _ = (name, mime_type);
    unsupported()
}

#[cfg(not(target_os = "android"))]
pub fn take_launch_uri() -> Result<Option<PickedDocument>> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
pub fn print_page() -> Result<()> {
    unsupported()
}
