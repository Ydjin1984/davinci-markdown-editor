//! Application-wide state shared by every command.

use crate::asset::AssetRoots;
use crate::cli::LaunchRequest;
use crate::error::Result;
use crate::paths;
use crate::settings::{Session, Settings, SettingsStore};
use crate::watcher::WatcherManager;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Files handed to us by the OS, either at startup or by a second launch.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPayload {
    pub files: Vec<String>,
    pub workspace: Option<String>,
}

impl LaunchPayload {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.workspace.is_none()
    }
}

pub struct AppState {
    pub store: SettingsStore,
    pub settings: Mutex<Settings>,
    pub watcher: WatcherManager,
    pub assets: AssetRoots,
    /// Paths that arrived before the frontend could listen for events.
    pending_launch: Mutex<LaunchPayload>,
    frontend_ready: AtomicBool,
    workspace_root: Mutex<Option<PathBuf>>,
    open_documents: Mutex<BTreeSet<PathBuf>>,
}

impl AppState {
    pub fn new(store: SettingsStore) -> Self {
        let settings = store.load();
        Self {
            store,
            settings: Mutex::new(settings),
            watcher: WatcherManager::new(),
            assets: AssetRoots::new(),
            pending_launch: Mutex::new(LaunchPayload::default()),
            frontend_ready: AtomicBool::new(false),
            workspace_root: Mutex::new(None),
            open_documents: Mutex::new(BTreeSet::new()),
        }
    }

    pub fn mark_frontend_ready(&self) {
        self.frontend_ready.store(true, Ordering::SeqCst);
    }

    pub fn is_frontend_ready(&self) -> bool {
        self.frontend_ready.load(Ordering::SeqCst)
    }

    /// Record a launch request that arrived too early to be emitted as an event.
    pub fn queue_launch(&self, request: LaunchRequest) {
        let mut pending = self.pending_launch.lock();
        for file in request.files {
            let value = file.to_string_lossy().into_owned();
            if !pending.files.contains(&value) {
                pending.files.push(value);
            }
        }
        if let Some(workspace) = request.workspace {
            pending.workspace = Some(workspace.to_string_lossy().into_owned());
        }
    }

    /// Drain the queued launch request. The frontend calls this once on mount.
    pub fn take_launch(&self) -> LaunchPayload {
        std::mem::take(&mut *self.pending_launch.lock())
    }

    pub fn workspace_root(&self) -> Option<PathBuf> {
        self.workspace_root.lock().clone()
    }

    pub fn set_workspace_root(&self, root: Option<PathBuf>) {
        *self.workspace_root.lock() = root;
    }

    pub fn open_documents(&self) -> Vec<PathBuf> {
        self.open_documents.lock().iter().cloned().collect()
    }

    pub fn track_document(&self, path: &Path) {
        self.open_documents.lock().insert(path.to_path_buf());
    }

    pub fn untrack_document(&self, path: &Path) {
        self.open_documents.lock().remove(path);
    }

    pub fn replace_document(&self, from: &Path, to: &Path) {
        let mut docs = self.open_documents.lock();
        docs.remove(from);
        docs.insert(to.to_path_buf());
    }

    pub fn apply_settings(&self, settings: Settings) -> Result<Settings> {
        self.store.save(&settings)?;
        *self.settings.lock() = settings.clone();
        Ok(settings)
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings.lock().clone()
    }

    pub fn touch_recent_file(&self, path: &Path) {
        let mut settings = self.settings.lock();
        settings.touch_recent_file(path);
        if let Err(err) = self.store.save(&settings) {
            log::warn!("saving recent files failed: {err}");
        }
    }

    pub fn touch_recent_workspace(&self, path: &Path) {
        let mut settings = self.settings.lock();
        settings.touch_recent_workspace(path);
        if let Err(err) = self.store.save(&settings) {
            log::warn!("saving recent workspaces failed: {err}");
        }
    }

    pub fn load_session(&self) -> Session {
        self.store.load_session()
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        self.store.save_session(session)
    }

    /// Allow the preview to read images next to any open document.
    pub fn refresh_asset_roots(&self) {
        let documents = self.open_documents();
        for document in &documents {
            if let Some(parent) = document.parent() {
                self.assets.allow_directory(parent);
            }
            self.assets.allow_file(document);
        }
        if let Some(root) = self.workspace_root() {
            self.assets.allow_directory(&root);
        }
    }

    /// Which directories must be watched right now.
    ///
    /// Document directories are watched non-recursively; the workspace root is
    /// watched recursively so the explorer stays current. Directories are used
    /// rather than files because saving replaces the file (atomic rename), which
    /// would invalidate a file-level inotify watch.
    pub fn watch_targets(&self) -> Vec<(PathBuf, bool)> {
        let mut targets: Vec<(PathBuf, bool)> = Vec::new();
        let root = self.workspace_root();
        if let Some(root) = root.as_ref() {
            if root.is_dir() {
                targets.push((root.clone(), true));
            }
        }
        for document in self.open_documents() {
            if let Some(parent) = document.parent() {
                let covered = root
                    .as_ref()
                    .is_some_and(|root| paths::is_within(root, parent));
                if !covered && parent.is_dir() && !targets.iter().any(|(path, _)| path == parent) {
                    targets.push((parent.to_path_buf(), false));
                }
            }
        }
        targets
    }
}
