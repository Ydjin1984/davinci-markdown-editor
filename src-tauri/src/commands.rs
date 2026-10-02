//! Every operation the webview is allowed to request.
//!
//! Nothing here trusts its arguments. Paths are resolved against an explicit
//! base, extensions are checked where they matter, and file dialogs run in Rust
//! so the frontend needs no broad plugin permissions at all.

use crate::asset::{AssetAccess, ASSET_SCHEME};
use crate::error::{AppError, ErrorCode, Result};
use crate::filesystem::{self, ExternalFileState, TextDocument, WriteOptions};
use crate::mobile;
use crate::paths;
use crate::settings::{Session, Settings};
use crate::state::{AppState, LaunchPayload};
use crate::watcher;
use crate::workspace::{self, DirEntryInfo, ListOptions, PathInfo};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
#[cfg(not(target_os = "android"))]
use tauri_plugin_dialog::FilePath;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_opener::OpenerExt;

fn absolutize(path: &str) -> Result<PathBuf> {
    paths::resolve(None, path)
}

/// Recompute watchers after the set of open documents or the workspace changed.
fn refresh_watchers(app: &AppHandle, state: &AppState) {
    let targets = state.watch_targets();
    state.watcher.sync(app, &targets);
}

fn after_document_change(app: &AppHandle, state: &AppState) {
    state.refresh_asset_roots();
    refresh_watchers(app, state);
}

// ---------------------------------------------------------------------------
// Startup hand-off
// ---------------------------------------------------------------------------

/// Files handed over by the OS. Drained exactly once, on frontend mount, so a
/// path can never be silently lost between "process started" and "UI is live".
#[tauri::command]
pub fn take_launch_payload(state: State<'_, AppState>) -> LaunchPayload {
    state.take_launch()
}

/// The document Android asked us to open at launch, if there was one.
///
/// The desktop equivalent is the command line, whose payload is queued by the
/// CLI parser instead; both end up as a document the interface opens.
#[tauri::command]
pub fn take_launch_uri() -> Result<Option<String>> {
    Ok(mobile::take_launch_uri()?.map(|picked| picked.uri))
}

#[tauri::command]
pub fn notify_frontend_ready(app: AppHandle, state: State<'_, AppState>) {
    state.mark_frontend_ready();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Bring the window to the front.
///
/// Restoring a minimised window is a desktop concept; the Android activity has
/// no such state and comes forward on its own.
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(desktop)]
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Queue a launch request that arrives while the UI is not listening yet.
pub fn deliver_launch(app: &AppHandle, request: crate::cli::LaunchRequest) {
    let state = app.state::<AppState>();
    if state.is_frontend_ready() {
        let payload = LaunchPayload {
            files: request
                .files
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            workspace: request
                .workspace
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        };
        if payload.is_empty() {
            return;
        }
        if let Err(err) = tauri::Emitter::emit(app, crate::OPEN_PATHS_EVENT, payload) {
            log::warn!("delivering open-paths failed: {err}");
        }
    } else {
        state.queue_launch(request);
    }

    if let Some(window) = app.get_webview_window("main") {
        #[cfg(desktop)]
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Settings and session
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings_snapshot()
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    let mut settings = settings;
    settings.sanitize();
    state.apply_settings(settings)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> Result<Settings> {
    let fresh = Settings::default();
    state.apply_settings(fresh)
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>) -> Session {
    state.load_session()
}

#[tauri::command]
pub fn set_session(state: State<'_, AppState>, session: Session) -> Result<()> {
    state.save_session(&session)
}

#[tauri::command]
pub fn forget_recent_file(state: State<'_, AppState>, path: String) -> Result<Settings> {
    let mut settings = state.settings_snapshot();
    settings.forget_recent_file(&path);
    state.apply_settings(settings)
}

#[tauri::command]
pub fn clear_recent(state: State<'_, AppState>) -> Result<Settings> {
    let mut settings = state.settings_snapshot();
    settings.files.recent_files.clear();
    settings.files.recent_workspaces.clear();
    state.apply_settings(settings)
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_document(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<TextDocument> {
    // A document chosen through the Android system picker is a `content://`
    // URI: it has no path to resolve and nothing for the watcher to follow.
    if mobile::is_content_uri(&path) {
        let document = mobile::read_document(&path)?;
        state.touch_recent_file(&PathBuf::from(&path));
        return Ok(document);
    }

    let resolved = absolutize(&path)?;
    let document = filesystem::read_text_document(&resolved)?;

    state.track_document(&resolved);
    state.touch_recent_file(&resolved);
    after_document_change(&app, &state);

    Ok(document)
}

#[tauri::command]
pub fn write_document(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    content: String,
    options: WriteOptions,
) -> Result<TextDocument> {
    if mobile::is_content_uri(&path) {
        let document = mobile::write_document(
            &path,
            &content,
            &options.eol.clone().unwrap_or_else(|| "lf".to_string()),
        )?;
        state.touch_recent_file(&PathBuf::from(&path));
        return Ok(document);
    }

    let resolved = absolutize(&path)?;
    let document = filesystem::write_text_document(&resolved, &content, &options)?;

    // Remember the hash we produced so the watcher does not report our own save
    // back to the UI as an external modification.
    state.watcher.note_self_write(&resolved, &document.hash);

    state.track_document(&resolved);
    state.touch_recent_file(&resolved);
    after_document_change(&app, &state);

    Ok(document)
}

/// Write an exported artefact (Mermaid SVG, rendered HTML, ...).
#[tauri::command]
pub fn write_export_file(path: String, content: String) -> Result<()> {
    if mobile::is_content_uri(&path) {
        return mobile::write_export(&path, &content);
    }

    let resolved = absolutize(&path)?;
    filesystem::write_bytes_atomic(&resolved, content.as_bytes())
}

#[tauri::command]
pub fn stat_file(path: String) -> Result<ExternalFileState> {
    // Android documents are only ever changed by this application, so the
    // answer the UI needs is "unchanged since the last read or write".
    if mobile::is_content_uri(&path) {
        return Ok(ExternalFileState {
            path,
            exists: true,
            size: 0,
            modified_ms: 0,
            hash: String::new(),
        });
    }

    let resolved = absolutize(&path)?;
    Ok(filesystem::stat_external(&resolved))
}

#[tauri::command]
pub fn close_document(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<()> {
    if mobile::is_content_uri(&path) {
        return Ok(());
    }

    let resolved = absolutize(&path)?;
    state.untrack_document(&resolved);
    state.assets.revoke_file(&resolved);
    after_document_change(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn path_info(path: String) -> Result<PathInfo> {
    let resolved = absolutize(&path)?;
    Ok(workspace::path_info(&resolved))
}

/// Resolve a Markdown-relative path against a document or workspace directory.
#[tauri::command]
pub fn resolve_relative(base: Option<String>, path: String) -> Result<String> {
    let base = match base {
        Some(base) if !base.is_empty() => Some(paths::resolve(None, &base)?),
        _ => None,
    };
    Ok(paths::resolve(base.as_deref(), &path)?
        .to_string_lossy()
        .into_owned())
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_directory(path: String, options: Option<ListOptions>) -> Result<Vec<DirEntryInfo>> {
    let resolved = absolutize(&path)?;
    workspace::list_directory(
        &resolved,
        &options.unwrap_or(ListOptions {
            include_ignored: false,
            extra_ignored: Vec::new(),
        }),
    )
}

#[tauri::command]
pub fn open_workspace(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<String> {
    let resolved = paths::resolve(None, &path)?;
    if !resolved.is_dir() {
        return Err(
            AppError::new(ErrorCode::NotADirectory, "That path is not a folder.")
                .with_path(&resolved),
        );
    }
    let canonical = paths::canonicalize_existing(&resolved)?;

    state.set_workspace_root(Some(canonical.clone()));
    state.touch_recent_workspace(&canonical);
    state.assets.allow_directory(&canonical);
    after_document_change(&app, &state);

    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn close_workspace(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.set_workspace_root(None);
    // Rebuild instead of revoking a single entry: the root may have been stored
    // under a different canonical form, and a full refresh cannot miss it.
    state.refresh_asset_roots();
    refresh_watchers(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>) -> Option<String> {
    state
        .workspace_root()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_file(
    app: AppHandle,
    state: State<'_, AppState>,
    parent: String,
    name: String,
    content: Option<String>,
) -> Result<String> {
    let parent = absolutize(&parent)?;
    let created = workspace::create_file(&parent, &name, content.as_deref().unwrap_or(""))?;
    refresh_watchers(&app, &state);
    Ok(created.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_directory(
    app: AppHandle,
    state: State<'_, AppState>,
    parent: String,
    name: String,
) -> Result<String> {
    let parent = absolutize(&parent)?;
    let created = workspace::create_directory(&parent, &name)?;
    refresh_watchers(&app, &state);
    Ok(created.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn rename_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    new_name: String,
    replace_in: Option<Vec<String>>,
) -> Result<Vec<String>> {
    let source = absolutize(&path)?;
    let renamed = workspace::rename_entry(&source, &new_name)?;

    // Anything the editor holds open at the old location has to follow the file.
    let mut updated: Vec<String> = Vec::new();
    state.replace_document(&source, &renamed);
    updated.push(source.to_string_lossy().into_owned());
    updated.push(renamed.to_string_lossy().into_owned());

    if let Some(root) = state.workspace_root() {
        if paths::is_within(&root, &source) || paths::is_within(&root, &renamed) {
            state.assets.allow_directory(&root);
        }
    }
    if let Some(parent) = renamed.parent() {
        state.assets.allow_directory(parent);
    }

    // A renamed directory changes every open document underneath it; the caller
    // passes the list so the UI can rewrite its tab paths.
    let _ = replace_in;

    refresh_watchers(&app, &state);
    Ok(updated)
}

#[tauri::command]
pub fn delete_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    permanent: Option<bool>,
) -> Result<()> {
    let resolved = absolutize(&path)?;
    workspace::delete_entry(&resolved, permanent.unwrap_or(false))?;
    state.untrack_document(&resolved);
    refresh_watchers(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn reveal_in_file_manager(app: AppHandle, path: String) -> Result<()> {
    let resolved = absolutize(&path)?;
    if !resolved.exists() {
        return Err(
            AppError::new(ErrorCode::NotFound, "The file or folder no longer exists.")
                .with_path(&resolved),
        );
    }
    app.opener().reveal_item_in_dir(&resolved).map_err(|err| {
        AppError::internal("The file manager could not be opened.").with_detail(err.to_string())
    })
}

// ---------------------------------------------------------------------------
// Shell integration
// ---------------------------------------------------------------------------

/// Hand a link to the operating system's default handler.
///
/// The URL is vetted first. It arrives from document content, which is
/// untrusted input, and it ends up as a request the user's browser makes on
/// their behalf. See [`crate::links`] for what is allowed and why.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<()> {
    let checked = crate::links::check(&url)?;

    app.opener()
        .open_url(checked.to_string(), None::<String>)
        .map_err(|err| {
            AppError::internal("The link could not be opened.").with_detail(err.to_string())
        })
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileFilterKind {
    Markdown,
    Svg,
    Html,
    Any,
}

/// Name the filters the desktop save dialog offers.
///
/// Android's own "create document" flow decides the type from the MIME type it
/// is started with, so there is no filter list to build there.
#[cfg(not(target_os = "android"))]
fn apply_filter<R: tauri::Runtime>(
    builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    kind: FileFilterKind,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    match kind {
        FileFilterKind::Markdown => {
            builder.add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
        }
        FileFilterKind::Svg => builder.add_filter("SVG image", &["svg"]),
        FileFilterKind::Html => builder.add_filter("HTML document", &["html", "htm"]),
        FileFilterKind::Any => builder,
    }
}

/// Keep the identity a picker returned.
///
/// A URL that is not a `file:` URL is a document URI from the Android picker
/// (`content://…`). It has no path form, but it is exactly what the mobile
/// bridge needs, so it is passed through instead of being dropped.
#[cfg(not(target_os = "android"))]
fn to_strings(paths: Vec<FilePath>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| match path {
            FilePath::Path(path) => path.to_string_lossy().into_owned(),
            FilePath::Url(url) => match url.to_file_path() {
                Ok(path) => path.to_string_lossy().into_owned(),
                Err(_) => url.to_string(),
            },
        })
        .collect()
}

#[tauri::command]
pub async fn pick_open_files(app: AppHandle) -> Result<Vec<String>> {
    // Android has no folder of Markdown documents to browse with a desktop
    // dialog; the system picker is the only way in, and it hands back URIs.
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(mobile::pick_document()?
            .map(|picked| vec![picked.uri])
            .unwrap_or_default())
    }

    #[cfg(not(target_os = "android"))]
    {
        let picked = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
            .add_filter("All files", &["*"])
            .blocking_pick_files();
        Ok(picked.map(to_strings).unwrap_or_default())
    }
}

/// Ask for a folder to open as a workspace.
///
/// Android has no folder picker in this dialog API, and no workspace concept
/// to open one into; the mobile interface offers single documents only.
#[tauri::command]
pub async fn pick_open_directory(app: AppHandle) -> Result<Option<String>> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err(AppError::new(
            ErrorCode::Unsupported,
            "Folders can only be opened on the desktop.",
        ))
    }

    #[cfg(not(target_os = "android"))]
    {
        let picked = app.dialog().file().blocking_pick_folder();
        Ok(picked.and_then(|p| to_strings(vec![p]).into_iter().next()))
    }
}

#[tauri::command]
pub async fn pick_save_path(
    app: AppHandle,
    default_name: Option<String>,
    kind: Option<FileFilterKind>,
    start_dir: Option<String>,
) -> Result<Option<String>> {
    // On Android the file is created by the system's own "create document"
    // flow; the URI it returns is what the following write fills in. A
    // starting directory has no equivalent there.
    #[cfg(target_os = "android")]
    {
        let _ = (app, start_dir);
        let name = default_name
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "document.md".to_string());
        let mime = match kind.unwrap_or(FileFilterKind::Markdown) {
            FileFilterKind::Markdown => "text/markdown",
            FileFilterKind::Html => "text/html",
            FileFilterKind::Svg => "image/svg+xml",
            FileFilterKind::Any => "application/octet-stream",
        };
        Ok(mobile::pick_save_file(&name, mime)?.map(|picked| picked.uri))
    }

    #[cfg(not(target_os = "android"))]
    {
        let mut builder = app.dialog().file().set_title("Save As");
        builder = apply_filter(builder, kind.unwrap_or(FileFilterKind::Markdown));

        if let Some(name) = default_name.as_deref().filter(|n| !n.is_empty()) {
            builder = builder.set_file_name(name);
        }
        if let Some(dir) = start_dir.as_deref().filter(|d| !d.is_empty()) {
            builder = builder.set_directory(dir);
        }

        let picked = builder.blocking_save_file();
        Ok(picked.and_then(|p| to_strings(vec![p]).into_iter().next()))
    }
}

/// Ask what to do about unsaved work.
///
/// Three answers are needed here rather than two: a plain yes/no dialog would
/// make "close the tab" ambiguous — the user could neither save *and* stay open
/// nor back out. Returns `save`, `discard` or `cancel`.
#[tauri::command]
pub async fn prompt_unsaved(
    app: AppHandle,
    title: String,
    message: String,
    save_label: Option<String>,
    discard_label: Option<String>,
    cancel_label: Option<String>,
) -> Result<String> {
    let answer = app
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            save_label.unwrap_or_else(|| "Save".into()),
            discard_label.unwrap_or_else(|| "Don't Save".into()),
            cancel_label.unwrap_or_else(|| "Cancel".into()),
        ))
        .blocking_show_with_result();

    let value = match answer {
        MessageDialogResult::Yes | MessageDialogResult::Ok => "save",
        MessageDialogResult::No => "discard",
        // A closed or unrecognised dialog must never be read as consent to
        // discard unsaved work, so everything else means "cancel".
        MessageDialogResult::Cancel | MessageDialogResult::Custom(_) => "cancel",
    };
    Ok(value.to_string())
}

/// Ask the user a yes/no question through a native dialog.
///
/// `buttons = "okCancel"` shows a confirmation with a Cancel button; anything
/// else shows a plain acknowledgement dialog. Returns `true` when the user
/// confirmed.
#[tauri::command]
pub async fn confirm_dialog(
    app: AppHandle,
    kind: Option<String>,
    title: String,
    message: String,
    buttons: Option<String>,
    ok_label: Option<String>,
    cancel_label: Option<String>,
) -> Result<bool> {
    let dialog_kind = match kind.as_deref() {
        Some("warning") => MessageDialogKind::Warning,
        Some("error") => MessageDialogKind::Error,
        _ => MessageDialogKind::Info,
    };

    let wants_cancel = buttons.as_deref() == Some("okCancel");
    let button_set = if wants_cancel {
        MessageDialogButtons::OkCancelCustom(
            ok_label.unwrap_or_else(|| "OK".into()),
            cancel_label.unwrap_or_else(|| "Cancel".into()),
        )
    } else {
        MessageDialogButtons::OkCustom(ok_label.unwrap_or_else(|| "OK".into()))
    };

    let confirmed = app
        .dialog()
        .message(message)
        .title(title)
        .kind(dialog_kind)
        .buttons(button_set)
        .blocking_show();

    Ok(confirmed)
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub config_dir: String,
    pub asset_scheme: String,
    pub asset_roots: Vec<String>,
    pub watched_paths: Vec<String>,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    let config_dir = state.store.dir().to_string_lossy().into_owned();
    AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        config_dir,
        asset_scheme: ASSET_SCHEME.to_string(),
        asset_roots: state.assets.describe(),
        watched_paths: state
            .watcher
            .watched_roots()
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    }
}

#[tauri::command]
pub fn asset_access(state: State<'_, AppState>) -> AssetAccess {
    AssetAccess {
        scheme: ASSET_SCHEME.to_string(),
        roots: state.assets.describe(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetProbe {
    pub path: String,
    pub exists: bool,
    /// Whether the preview is allowed to read this path at all.
    pub allowed: bool,
    /// Whether the extension is one the preview will inline.
    pub inlineable: bool,
}

/// Read an asset and return it as a `data:` URL.
///
/// Used by the HTML export to embed images, which is what makes the exported
/// file self-contained. The path goes through the same allow-list as the
/// preview itself, so the export cannot reach anything the preview could not.
#[tauri::command]
pub fn read_asset_data_url(state: State<'_, AppState>, path: String) -> Result<String> {
    use base64::Engine as _;

    let resolved = paths::resolve(None, &path)?;
    let canonical = state.assets.resolve(&resolved).ok_or_else(|| {
        AppError::new(
            ErrorCode::PermissionDenied,
            "That file is outside the folders the preview may read.",
        )
        .with_path(&resolved)
    })?;

    let meta = std::fs::metadata(&canonical).map_err(|e| AppError::from_io(&e, &canonical))?;
    if meta.len() > filesystem::MAX_TEXT_BYTES {
        return Err(
            AppError::new(ErrorCode::TooLarge, "The file is too large to embed.")
                .with_path(&canonical),
        );
    }

    let bytes = std::fs::read(&canonical).map_err(|e| AppError::from_io(&e, &canonical))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!(
        "data:{};base64,{}",
        paths::mime_for_path(&canonical),
        encoded
    ))
}

/// Open the operating system's print dialog for the main window.
///
/// Windows shows the WebView2 print preview and Linux the GTK print dialog;
/// both offer "save as PDF", and both use the same engine that drew the
/// preview, so the output matches what the user is looking at. Android has no
/// `window.print()`: the same webview is handed to the platform's
/// `PrintManager`, whose dialog also offers "Save as PDF". The frontend
/// switches to the print layout before calling this on every platform.
#[tauri::command]
pub fn print_document(app: AppHandle) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        mobile::print_page()
    }

    #[cfg(not(target_os = "android"))]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::internal("The application window is not available."))?;

        window.print().map_err(|err| {
            AppError::internal("The print dialog could not be opened.").with_detail(err.to_string())
        })
    }
}

/// Explain why an image in the preview failed to load.
///
/// A broken-image icon tells the user nothing. This distinguishes the three
/// realistic causes — the file is gone, it sits outside the folders the preview
/// may read, or it is a type the preview will not inline — so the placeholder
/// can say which one it is.
#[tauri::command]
pub fn probe_asset(state: State<'_, AppState>, path: String) -> Result<AssetProbe> {
    let resolved = paths::resolve(None, &path)?;
    Ok(AssetProbe {
        exists: resolved.exists(),
        allowed: state.assets.allows(&resolved),
        inlineable: paths::is_inline_asset(&resolved),
        path: resolved.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn markdown_extensions() -> Vec<String> {
    paths::MARKDOWN_EXTENSIONS
        .iter()
        .map(|ext| (*ext).to_string())
        .collect()
}

/// Re-exported so the frontend and the docs refer to one constant.
pub use watcher::FS_CHANGED_EVENT;
