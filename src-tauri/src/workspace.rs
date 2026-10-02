//! Workspace and file-tree operations.
//!
//! The explorer is loaded lazily: `list_directory` returns exactly one level so
//! opening a repository with 50k files costs nothing until the user expands a
//! node.

use crate::error::{AppError, ErrorCode, Result};
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Directory names hidden from the explorer unless the user asks for them.
pub const DEFAULT_IGNORED_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".DS_Store",
    "node_modules",
    "__pycache__",
    ".venv",
    "target",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_markdown: bool,
    pub extension: Option<String>,
    pub size: u64,
    pub modified_ms: u64,
    /// Whether a directory has any visible child, so the tree can decide
    /// between a chevron and blank space without expanding it.
    pub has_children: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    #[serde(default)]
    pub include_ignored: bool,
    #[serde(default)]
    pub extra_ignored: Vec<String>,
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_ignored(name: &str, options: &ListOptions) -> bool {
    if options.include_ignored {
        return false;
    }
    if DEFAULT_IGNORED_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
    {
        return true;
    }
    options
        .extra_ignored
        .iter()
        .any(|candidate| candidate == name)
}

/// Cheap probe used to render expand chevrons.
fn directory_has_visible_children(path: &Path, options: &ListOptions) -> bool {
    let Ok(reader) = fs::read_dir(path) else {
        return false;
    };
    for entry in reader.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name, options) {
            continue;
        }
        return true;
    }
    false
}

pub fn list_directory(path: &Path, options: &ListOptions) -> Result<Vec<DirEntryInfo>> {
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, path))?;
    if !meta.is_dir() {
        return Err(
            AppError::new(ErrorCode::NotADirectory, "That path is not a folder.").with_path(path),
        );
    }

    let reader = fs::read_dir(path).map_err(|e| AppError::from_io(&e, path))?;
    let mut entries: Vec<DirEntryInfo> = Vec::new();

    for entry in reader {
        // A single unreadable child (broken symlink, permission denied) must not
        // fail the whole listing.
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name, options) {
            continue;
        }

        let entry_path = entry.path();
        let symlink_meta = fs::symlink_metadata(&entry_path).ok();
        let is_symlink = symlink_meta
            .as_ref()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);

        // Prefer the resolved metadata so symlinks report their target's type;
        // fall back to the link itself when the target is gone.
        let meta = match fs::metadata(&entry_path) {
            Ok(meta) => meta,
            Err(_) => match symlink_meta {
                Some(meta) => meta,
                None => continue,
            },
        };

        let is_dir = meta.is_dir();
        let extension = paths::extension_lowercase(&entry_path);

        entries.push(DirEntryInfo {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            is_dir,
            is_symlink,
            is_markdown: paths::is_markdown_path(&entry_path),
            extension,
            size: if is_dir { 0 } else { meta.len() },
            modified_ms: modified_ms(&meta),
            has_children: is_dir && directory_has_visible_children(&entry_path, options),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => compare_natural(&a.name, &b.name),
    });

    Ok(entries)
}

/// Case-insensitive comparison that orders `file2` before `file10`.
fn compare_natural(a: &str, b: &str) -> std::cmp::Ordering {
    let mut left = a.chars().peekable();
    let mut right = b.chars().peekable();

    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(lc), Some(rc)) => {
                if lc.is_ascii_digit() && rc.is_ascii_digit() {
                    let mut lnum = String::new();
                    while let Some(c) = left.peek().copied().filter(char::is_ascii_digit) {
                        lnum.push(c);
                        left.next();
                    }
                    let mut rnum = String::new();
                    while let Some(c) = right.peek().copied().filter(char::is_ascii_digit) {
                        rnum.push(c);
                        right.next();
                    }
                    let ln: u128 = lnum.parse().unwrap_or(u128::MAX);
                    let rn: u128 = rnum.parse().unwrap_or(u128::MAX);
                    match ln.cmp(&rn) {
                        std::cmp::Ordering::Equal => continue,
                        other => return other,
                    }
                }
                left.next();
                right.next();
                let lo = lc.to_lowercase().next().unwrap_or(lc);
                let ro = rc.to_lowercase().next().unwrap_or(rc);
                match lo.cmp(&ro) {
                    std::cmp::Ordering::Equal => continue,
                    other => return other,
                }
            }
        }
    }
}

/// Validate a single path component typed by the user ("New folder").
pub fn validate_component(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(ErrorCode::InvalidPath, "A name is required."));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "That name is reserved.",
        ));
    }
    if trimmed.contains(['/', '\\']) || trimmed.contains('\0') {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "A name cannot contain path separators.",
        ));
    }
    #[cfg(windows)]
    {
        if trimmed.contains(['<', '>', ':', '"', '|', '?', '*']) {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "The name contains characters Windows does not allow.",
            ));
        }
        let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
        const RESERVED: &[&str] = &[
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        if RESERVED.contains(&stem.as_str()) {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "That name is reserved by Windows.",
            ));
        }
        if trimmed.ends_with(['.', ' ']) {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "A name cannot end with a dot or a space on Windows.",
            ));
        }
    }
    Ok(trimmed.to_string())
}

pub fn create_file(parent: &Path, name: &str, initial_content: &str) -> Result<PathBuf> {
    let name = validate_component(name)?;
    let target = parent.join(&name);
    if target.exists() {
        return Err(AppError::new(
            ErrorCode::AlreadyExists,
            "A file or folder with that name already exists.",
        )
        .with_path(&target));
    }
    if !parent.is_dir() {
        return Err(AppError::new(
            ErrorCode::NotADirectory,
            "The target folder does not exist.",
        )
        .with_path(parent));
    }
    crate::filesystem::write_bytes_atomic(&target, initial_content.as_bytes())?;
    Ok(target)
}

pub fn create_directory(parent: &Path, name: &str) -> Result<PathBuf> {
    let name = validate_component(name)?;
    let target = parent.join(&name);
    if target.exists() {
        return Err(AppError::new(
            ErrorCode::AlreadyExists,
            "A file or folder with that name already exists.",
        )
        .with_path(&target));
    }
    fs::create_dir(&target).map_err(|e| AppError::from_io(&e, &target))?;
    Ok(target)
}

pub fn rename_entry(path: &Path, new_name: &str) -> Result<PathBuf> {
    let new_name = validate_component(new_name)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_path(path, "cannot rename a filesystem root"))?;
    let target = parent.join(&new_name);

    if target == path {
        return Ok(target);
    }
    if target.exists() {
        return Err(AppError::new(
            ErrorCode::AlreadyExists,
            "A file or folder with that name already exists.",
        )
        .with_path(&target));
    }
    fs::rename(path, &target).map_err(|e| AppError::from_io(&e, path))?;
    Ok(target)
}

/// Move a path to the OS trash. `permanent` is reserved for the explicit
/// "delete permanently" confirmation in the UI.
///
/// Android has no trash for an application to move files into — the platform's
/// own file manager owns that — so only the permanent branch exists there. The
/// mobile interface has no delete at all, which keeps that difference out of
/// the user's way.
pub fn delete_entry(path: &Path, permanent: bool) -> Result<()> {
    if !path.exists() {
        return Err(AppError::from_io(
            &std::io::Error::new(std::io::ErrorKind::NotFound, "not found"),
            path,
        ));
    }

    #[cfg(desktop)]
    if !permanent {
        return trash::delete(path).map_err(|err| {
            AppError::new(ErrorCode::Io, "The item could not be moved to the trash.")
                .with_path(path)
                .with_detail(err.to_string())
        });
    }

    #[cfg(not(desktop))]
    let _ = permanent;

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| AppError::from_io(&e, path))
    } else {
        fs::remove_file(path).map_err(|e| AppError::from_io(&e, path))
    }
}

pub fn ensure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(|e| AppError::from_io(&e, path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_markdown: bool,
    pub read_only: bool,
}

pub fn path_info(path: &Path) -> PathInfo {
    match fs::metadata(path) {
        Ok(meta) => PathInfo {
            path: path.to_string_lossy().into_owned(),
            exists: true,
            is_dir: meta.is_dir(),
            is_file: meta.is_file(),
            is_markdown: paths::is_markdown_path(path),
            read_only: meta.permissions().readonly(),
        },
        Err(_) => PathInfo {
            path: path.to_string_lossy().into_owned(),
            exists: false,
            is_dir: false,
            is_file: false,
            is_markdown: paths::is_markdown_path(path),
            read_only: false,
        },
    }
}

/// Count Markdown files under a directory; used for the status bar summary.
pub fn count_markdown_files(root: &Path, limit: usize) -> usize {
    walkdir::WalkDir::new(root)
        .max_depth(6)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !DEFAULT_IGNORED_NAMES
                .iter()
                .any(|c| c.eq_ignore_ascii_case(&name))
        })
        .filter_map(std::result::Result::ok)
        .filter(|entry| entry.file_type().is_file() && paths::is_markdown_path(entry.path()))
        .take(limit)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order_sorts_numbers_numerically() {
        assert_eq!(
            compare_natural("file2.md", "file10.md"),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            compare_natural("File2.md", "file10.md"),
            std::cmp::Ordering::Less
        );
        assert_eq!(compare_natural("a.md", "b.md"), std::cmp::Ordering::Less);
    }

    #[test]
    fn component_validation_rejects_separators() {
        assert!(validate_component("ok.md").is_ok());
        assert!(validate_component("bad/name.md").is_err());
        assert!(validate_component("..").is_err());
        assert!(validate_component("   ").is_err());
        assert!(validate_component("with\0nul").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn component_validation_rejects_windows_reserved_names() {
        assert!(validate_component("CON.md").is_err());
        assert!(validate_component("trailing.").is_err());
        assert!(validate_component("bad:name").is_err());
    }
}
