//! Structured errors crossing the IPC boundary.
//!
//! The UI must never surface a raw panic or an `io::Error` debug dump, so every
//! failure is normalised into a stable machine-readable `code` plus a short
//! human message. Technical detail stays in `detail` for the log file.

use serde::Serialize;
use std::fmt;
use std::path::Path;

pub type Result<T> = std::result::Result<T, AppError>;

/// Stable error taxonomy. The frontend maps these to localised strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NotFound,
    PermissionDenied,
    IsADirectory,
    NotADirectory,
    InvalidPath,
    AlreadyExists,
    NotEmpty,
    Encoding,
    TooLarge,
    Unsupported,
    Busy,
    /// On-disk content changed since the editor last read it.
    Conflict,
    Watch,
    Io,
    Internal,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::NotFound => "notFound",
            ErrorCode::PermissionDenied => "permissionDenied",
            ErrorCode::IsADirectory => "isADirectory",
            ErrorCode::NotADirectory => "notADirectory",
            ErrorCode::InvalidPath => "invalidPath",
            ErrorCode::AlreadyExists => "alreadyExists",
            ErrorCode::NotEmpty => "notEmpty",
            ErrorCode::Encoding => "encoding",
            ErrorCode::TooLarge => "tooLarge",
            ErrorCode::Unsupported => "unsupported",
            ErrorCode::Busy => "busy",
            ErrorCode::Conflict => "conflict",
            ErrorCode::Watch => "watch",
            ErrorCode::Io => "io",
            ErrorCode::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// Short, user-facing sentence. Safe to show in a dialog.
    pub message: String,
    /// Technical detail for logs; never used as the primary UI text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            path: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn with_path(mut self, path: impl AsRef<Path>) -> Self {
        self.path = Some(path.as_ref().to_string_lossy().into_owned());
        self
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn invalid_path(path: impl AsRef<Path>, reason: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidPath, "The path is not usable.")
            .with_path(path)
            .with_detail(reason)
    }

    /// Classify an `io::Error` into the closest user-meaningful code.
    pub fn from_io(err: &std::io::Error, path: impl AsRef<Path>) -> Self {
        let path_ref = path.as_ref();
        let code = match err.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            std::io::ErrorKind::AlreadyExists => ErrorCode::AlreadyExists,
            std::io::ErrorKind::IsADirectory => ErrorCode::IsADirectory,
            std::io::ErrorKind::NotADirectory => ErrorCode::NotADirectory,
            std::io::ErrorKind::ResourceBusy | std::io::ErrorKind::WouldBlock => ErrorCode::Busy,
            std::io::ErrorKind::InvalidInput | std::io::ErrorKind::InvalidData => {
                ErrorCode::InvalidPath
            }
            _ => ErrorCode::Io,
        };

        // Windows reports "access denied" for a directory opened as a file and
        // for a file opened as a directory; refine using the metadata we have.
        let code = match code {
            ErrorCode::PermissionDenied if path_ref.is_dir() => ErrorCode::IsADirectory,
            other => other,
        };

        let message = match code {
            ErrorCode::NotFound => "The file or folder no longer exists.",
            ErrorCode::PermissionDenied => {
                "Permission denied. Check the file permissions and try again."
            }
            ErrorCode::IsADirectory => "That path is a folder, not a file.",
            ErrorCode::NotADirectory => "A part of the path is not a folder.",
            ErrorCode::AlreadyExists => "A file or folder with that name already exists.",
            ErrorCode::Busy => "The file is in use by another program.",
            ErrorCode::InvalidPath => "The path is not usable.",
            _ => "The operation could not be completed.",
        };

        Self::new(code, message)
            .with_path(path_ref)
            .with_detail(err.to_string())
    }

    pub fn to_log_line(&self) -> String {
        match (&self.path, &self.detail) {
            (Some(p), Some(d)) => format!("[{}] {} ({p}): {d}", self.code.as_str(), self.message),
            (Some(p), None) => format!("[{}] {} ({p})", self.code.as_str(), self.message),
            (None, Some(d)) => format!("[{}] {}: {d}", self.code.as_str(), self.message),
            (None, None) => format!("[{}] {}", self.code.as_str(), self.message),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_log_line())
    }
}

impl std::error::Error for AppError {}

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_log_line()
    }
}

/// Helper for commands that must produce something from a poisoned mutex.
pub fn lock<T>(mutex: &parking_lot::Mutex<T>) -> parking_lot::MutexGuard<'_, T> {
    // parking_lot mutexes are not poisoned by panics, so this cannot fail.
    mutex.lock()
}
