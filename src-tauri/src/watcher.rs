//! Filesystem watching for external modifications.
//!
//! Design notes:
//! * Events are coalesced for [`DEBOUNCE`] so a single `Ctrl+S` in another
//!   editor does not produce a burst of notifications.
//! * A write performed by this application is recognised by comparing the file
//!   on disk with the hash we just saved, and is dropped. Content comparison is
//!   used instead of a timing window because it stays correct even when the
//!   save and the notification are far apart in time.
//! * Watcher failures degrade to "no external change detection"; they never
//!   take the editor down.

use crate::error::{AppError, Result};
use crate::filesystem;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const FS_CHANGED_EVENT: &str = "fs://changed";

/// Coalescing window for burst writes.
const DEBOUNCE: Duration = Duration::from_millis(160);
/// Upper bound on remembered self-writes.
const SELF_WRITE_LIMIT: usize = 512;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    pub path: String,
    /// `created` | `modified` | `removed` | `renamed`
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    pub changes: Vec<FsChange>,
}

struct RawEvent {
    path: PathBuf,
    kind: &'static str,
    to: Option<PathBuf>,
}

struct Inner {
    watcher: RecommendedWatcher,
    watched: HashMap<PathBuf, RecursiveMode>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

pub struct WatcherManager {
    inner: Mutex<Option<Inner>>,
    /// Absolute path -> SHA-256 of the content this application last wrote.
    self_writes: Arc<Mutex<HashMap<PathBuf, String>>>,
}

impl Default for WatcherManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            self_writes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Remember the hash of a file this application just wrote so the resulting
    /// filesystem notification is not reported back as an external change.
    pub fn note_self_write(&self, path: &Path, hash: &str) {
        let mut writes = self.self_writes.lock();
        if writes.len() >= SELF_WRITE_LIMIT {
            // Drop an arbitrary half to keep the map bounded.
            let keys: Vec<PathBuf> = writes.keys().take(SELF_WRITE_LIMIT / 2).cloned().collect();
            for key in keys {
                writes.remove(&key);
            }
        }
        writes.insert(path.to_path_buf(), hash.to_string());
    }

    pub fn forget_self_write(&self, path: &Path) {
        self.self_writes.lock().remove(path);
    }

    /// Start watching a path. Idempotent: watching an already watched path with
    /// the same mode is a no-op.
    pub fn watch(&self, app: &AppHandle, path: &Path, recursive: bool) -> Result<()> {
        if !path.exists() {
            return Err(AppError::new(
                crate::error::ErrorCode::NotFound,
                "Nothing to watch at that path.",
            )
            .with_path(path));
        }

        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };

        let mut guard = self.inner.lock();
        if let Some(inner) = guard.as_mut() {
            if inner.watched.get(path) == Some(&mode) {
                return Ok(());
            }
            if let Err(err) = inner.watcher.watch(path, mode) {
                return Err(watch_error(path, err));
            }
            inner.watched.insert(path.to_path_buf(), mode);
            return Ok(());
        }

        let inner = create_inner(app, path, mode, self.self_writes.clone())?;
        *guard = Some(inner);
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) -> Result<()> {
        let mut guard = self.inner.lock();
        if let Some(inner) = guard.as_mut() {
            if inner.watched.remove(path).is_some() {
                if let Err(err) = inner.watcher.unwatch(path) {
                    log::debug!("unwatch {path:?} failed: {err}");
                }
            }
        }
        Ok(())
    }

    /// Replace the watched set, keeping a single watcher instance alive.
    pub fn sync(&self, app: &AppHandle, desired: &[(PathBuf, bool)]) {
        let wanted: HashMap<PathBuf, RecursiveMode> = desired
            .iter()
            .map(|(path, recursive)| {
                (
                    path.clone(),
                    if *recursive {
                        RecursiveMode::Recursive
                    } else {
                        RecursiveMode::NonRecursive
                    },
                )
            })
            .collect();

        let mut guard = self.inner.lock();

        if guard.is_none() {
            let Some(first) = wanted.iter().next() else {
                return;
            };
            match create_inner(app, first.0, *first.1, self.self_writes.clone()) {
                Ok(mut created) => {
                    for (path, mode) in wanted.iter().skip(1) {
                        if let Err(err) = created.watcher.watch(path, *mode) {
                            log::warn!("watching {} failed: {err}", path.display());
                            continue;
                        }
                        created.watched.insert(path.clone(), *mode);
                    }
                    *guard = Some(created);
                }
                Err(err) => log::warn!("{err}"),
            }
            return;
        }

        let inner = guard.as_mut().expect("checked above");

        let stale: Vec<PathBuf> = inner
            .watched
            .keys()
            .filter(|path| !wanted.contains_key(*path))
            .cloned()
            .collect();
        for path in stale {
            let _ = inner.watcher.unwatch(&path);
            inner.watched.remove(&path);
        }

        let missing: Vec<(PathBuf, RecursiveMode)> = wanted
            .iter()
            .filter(|(path, _)| !inner.watched.contains_key(*path))
            .map(|(path, mode)| (path.clone(), *mode))
            .collect();
        for (path, mode) in missing {
            if let Err(err) = inner.watcher.watch(&path, mode) {
                log::warn!("watching {} failed: {err}", path.display());
                continue;
            }
            inner.watched.insert(path, mode);
        }
    }

    pub fn watched_roots(&self) -> Vec<PathBuf> {
        self.inner
            .lock()
            .as_ref()
            .map(|inner| inner.watched.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn shutdown(&self) {
        if let Some(mut inner) = self.inner.lock().take() {
            inner.stop.store(true, Ordering::SeqCst);
            if let Some(worker) = inner.worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn watch_error(path: &Path, err: notify::Error) -> AppError {
    AppError::new(
        crate::error::ErrorCode::Watch,
        "Changes to this file cannot be watched.",
    )
    .with_path(path)
    .with_detail(err.to_string())
}

fn create_inner(
    app: &AppHandle,
    path: &Path,
    mode: RecursiveMode,
    self_writes: Arc<Mutex<HashMap<PathBuf, String>>>,
) -> Result<Inner> {
    let (tx, rx): (Sender<RawEvent>, Receiver<RawEvent>) = mpsc::channel();

    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<Event>| match result {
            Ok(event) => forward(&tx, event),
            Err(err) => log::debug!("watcher error: {err}"),
        })
        .map_err(|err| watch_error(path, err))?;

    watcher
        .watch(path, mode)
        .map_err(|err| watch_error(path, err))?;

    let mut watched = HashMap::new();
    watched.insert(path.to_path_buf(), mode);

    let stop = Arc::new(AtomicBool::new(false));
    let worker = {
        let app = app.clone();
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("davinci-fs-watch".into())
            .spawn(move || worker_loop(app, rx, self_writes, stop))
            .ok()
    };

    Ok(Inner {
        watcher,
        watched,
        stop,
        worker,
    })
}

fn forward(tx: &Sender<RawEvent>, event: Event) {
    // Access events (open/close/read) are noise for an editor.
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }

    match event.kind {
        EventKind::Create(_) => {
            for path in event.paths {
                let _ = tx.send(RawEvent {
                    path,
                    kind: "created",
                    to: None,
                });
            }
        }
        EventKind::Remove(_) => {
            for path in event.paths {
                let _ = tx.send(RawEvent {
                    path,
                    kind: "removed",
                    to: None,
                });
            }
        }
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
            let mut paths = event.paths.into_iter();
            match (paths.next(), paths.next()) {
                (Some(from), Some(to)) => {
                    let _ = tx.send(RawEvent {
                        path: from,
                        kind: "renamed",
                        to: Some(to),
                    });
                }
                (Some(only), None) => {
                    let _ = tx.send(RawEvent {
                        path: only,
                        kind: "modified",
                        to: None,
                    });
                }
                _ => {}
            }
        }
        _ => {
            for path in event.paths {
                let _ = tx.send(RawEvent {
                    path,
                    kind: "modified",
                    to: None,
                });
            }
        }
    }
}

fn worker_loop(
    app: AppHandle,
    rx: Receiver<RawEvent>,
    self_writes: Arc<Mutex<HashMap<PathBuf, String>>>,
    stop: Arc<AtomicBool>,
) {
    let mut pending: Vec<RawEvent> = Vec::new();
    let mut deadline: Option<Instant> = None;

    loop {
        if stop.load(Ordering::SeqCst) {
            return;
        }

        let timeout = deadline
            .map(|at| at.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_millis(250));

        match rx.recv_timeout(timeout) {
            Ok(event) => {
                pending.push(event);
                deadline = Some(Instant::now() + DEBOUNCE);
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Some(at) = deadline {
                    if Instant::now() >= at {
                        flush(&app, &mut pending, &self_writes);
                        deadline = None;
                    }
                } else if !pending.is_empty() {
                    flush(&app, &mut pending, &self_writes);
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                flush(&app, &mut pending, &self_writes);
                return;
            }
        }
    }
}

fn flush(
    app: &AppHandle,
    pending: &mut Vec<RawEvent>,
    self_writes: &Arc<Mutex<HashMap<PathBuf, String>>>,
) {
    if pending.is_empty() {
        return;
    }

    // Last event per path wins, which collapses the create+modify+modify burst
    // of a normal save into one notification.
    let mut ordered: Vec<PathBuf> = Vec::new();
    let mut by_path: HashMap<PathBuf, RawEvent> = HashMap::new();
    for event in pending.drain(..) {
        if !by_path.contains_key(&event.path) {
            ordered.push(event.path.clone());
        }
        by_path.insert(event.path.clone(), event);
    }

    let mut changes: Vec<FsChange> = Vec::with_capacity(ordered.len());
    for path in ordered {
        let Some(event) = by_path.remove(&path) else {
            continue;
        };

        if event.kind == "renamed" {
            if let Some(to) = event.to.clone() {
                if is_self_write(&to, self_writes) {
                    continue;
                }
                changes.push(FsChange {
                    path: path.to_string_lossy().into_owned(),
                    kind: "renamed".into(),
                    to: Some(to.to_string_lossy().into_owned()),
                });
                continue;
            }
        }

        if event.kind != "removed" && is_self_write(&path, self_writes) {
            continue;
        }

        changes.push(FsChange {
            path: path.to_string_lossy().into_owned(),
            kind: event.kind.to_string(),
            to: None,
        });
    }

    if changes.is_empty() {
        return;
    }

    if let Err(err) = app.emit(FS_CHANGED_EVENT, FsChangedPayload { changes }) {
        log::debug!("emitting {FS_CHANGED_EVENT} failed: {err}");
    }
}

/// True when the file on disk still matches what this application wrote.
fn is_self_write(path: &Path, self_writes: &Arc<Mutex<HashMap<PathBuf, String>>>) -> bool {
    let expected = {
        let writes = self_writes.lock();
        match writes.get(path) {
            Some(hash) => hash.clone(),
            None => return false,
        }
    };

    let matches = filesystem::hash_file_normalized(path).is_some_and(|disk| disk == expected);

    if matches {
        // Consume the marker: the next change is genuinely external.
        self_writes.lock().remove(path);
    }
    matches
}
