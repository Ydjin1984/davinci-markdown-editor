//! Text document reading and writing.
//!
//! Responsibilities:
//! * encoding detection (BOM, then statistical detection, then UTF-8 lossy);
//! * EOL detection and normalisation (`\n` in memory, original EOL restored on
//!   save so untouched files stay byte-compatible);
//! * atomic replacement so a crash mid-write cannot truncate the document.

use crate::error::{AppError, ErrorCode, Result};
use crate::paths;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Refuse to load anything larger than this as text; a Markdown editor has no
/// business pulling a multi-gigabyte binary into a JS string.
pub const MAX_TEXT_BYTES: u64 = 128 * 1024 * 1024;

/// Bytes inspected for encoding detection and binary sniffing.
const SNIFF_BYTES: usize = 64 * 1024;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocument {
    pub path: String,
    pub name: String,
    pub dir: String,
    /// Always LF-normalised so editor offsets are stable.
    pub content: String,
    /// Canonical encoding label (`UTF-8`, `windows-1251`, ...).
    pub encoding: String,
    /// `lf` or `crlf`, as found on disk.
    pub eol: String,
    pub bom: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub read_only: bool,
    /// SHA-256 of the normalised content; used for dirty and conflict checks.
    pub hash: String,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileState {
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub hash: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Count CRLF versus bare LF to decide the document's dominant line ending.
pub fn detect_eol(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let bare_lf = text.matches('\n').count().saturating_sub(crlf);
    let bare_cr = text.matches('\r').count().saturating_sub(crlf);
    if crlf + bare_cr > bare_lf {
        "crlf"
    } else {
        "lf"
    }
}

/// Normalise any mix of CRLF/CR to LF.
pub fn normalize_newlines(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(ch);
        }
    }
    out
}

/// Apply the requested line ending to LF-normalised text.
pub fn apply_eol(text: &str, eol: &str) -> String {
    if eol.eq_ignore_ascii_case("crlf") {
        if !text.contains('\n') {
            return text.to_string();
        }
        let mut out = String::with_capacity(text.len() + text.len() / 16);
        let mut chars = text.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\n' {
                out.push('\r');
            } else if ch == '\r' {
                out.push('\r');
                if chars.peek() == Some(&'\n') {
                    continue;
                }
            }
            out.push(ch);
        }
        out
    } else {
        normalize_newlines(text)
    }
}

/// BOM sniffing plus a UTF-16 heuristic. Returns the encoding, BOM length and
/// whether a BOM was present.
fn sniff_encoding(bytes: &[u8]) -> Option<(&'static Encoding, usize, bool)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some((UTF_8, 3, true));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some((UTF_16LE, 2, true));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some((UTF_16BE, 2, true));
    }
    None
}

/// Statistical detection for legacy encodings (windows-1251, KOI8-R, ...).
fn detect_legacy_encoding(bytes: &[u8]) -> &'static Encoding {
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    detector.guess(None, true)
}

/// A file is treated as binary when the sniff window contains a NUL byte that
/// is not part of a UTF-16 BOM signature.
fn looks_binary(bytes: &[u8]) -> bool {
    let window = &bytes[..bytes.len().min(8192)];
    if window.contains(&0) {
        // UTF-16 without a BOM still has NULs in ASCII text; only flag it when
        // the NULs are not in a consistent alternating pattern.
        let even_nuls = window.iter().step_by(2).filter(|b| **b == 0).count();
        let odd_nuls = window
            .iter()
            .skip(1)
            .step_by(2)
            .filter(|b| **b == 0)
            .count();
        let half = window.len() / 2;
        let looks_utf16 =
            (even_nuls > half / 2 && odd_nuls == 0) || (odd_nuls > half / 2 && even_nuls == 0);
        return !looks_utf16;
    }
    false
}

/// Decode bytes into text, returning the canonical encoding label and whether a
/// BOM was consumed.
fn decode(bytes: &[u8]) -> (String, &'static Encoding, bool) {
    if let Some((encoding, bom_len, had_bom)) = sniff_encoding(bytes) {
        let (text, _, _) = encoding.decode(&bytes[bom_len..]);
        return (text.into_owned(), encoding, had_bom);
    }

    let encoding = detect_legacy_encoding(bytes);
    let (text, _, had_errors) = encoding.decode(bytes);

    if had_errors && encoding == UTF_8 {
        // Invalid UTF-8 byte sequences: keep every recoverable character
        // instead of failing the whole open operation.
        let (lossy, _, _) = UTF_8.decode(bytes);
        return (lossy.into_owned(), encoding, false);
    }

    (text.into_owned(), encoding, false)
}

pub fn read_text_document(path: &Path) -> Result<TextDocument> {
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(&e, path))?;

    if meta.is_dir() {
        return Err(AppError::new(
            ErrorCode::IsADirectory,
            "That path is a folder, not a file.",
        )
        .with_path(path));
    }

    if meta.len() > MAX_TEXT_BYTES {
        return Err(AppError::new(
            ErrorCode::TooLarge,
            "The file is too large to open in the editor.",
        )
        .with_path(path)
        .with_detail(format!(
            "{} bytes exceeds the {} byte limit",
            meta.len(),
            MAX_TEXT_BYTES
        )));
    }

    let mut file = fs::File::open(path).map_err(|e| AppError::from_io(&e, path))?;
    let mut bytes = Vec::with_capacity(meta.len().min(SNIFF_BYTES as u64) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|e| AppError::from_io(&e, path))?;

    if looks_binary(&bytes) {
        return Err(AppError::new(
            ErrorCode::Unsupported,
            "This file does not look like a text document.",
        )
        .with_path(path));
    }

    let (decoded, encoding, bom) = decode(&bytes);
    let eol = detect_eol(&decoded);
    let content = normalize_newlines(&decoded);

    let read_only = meta.permissions().readonly();
    let name = paths::file_name_or_path(path);
    let dir = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(TextDocument {
        path: path.to_string_lossy().into_owned(),
        name,
        dir,
        line_count: content.lines().count().max(1),
        hash: hash_text(&content),
        content,
        encoding: encoding.name().to_string(),
        eol: eol.to_string(),
        bom,
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        read_only,
    })
}

/// Hash of a file's decoded, EOL-normalised content.
///
/// Used by the watcher to recognise our own writes: the comparison has to use
/// exactly the same normalisation as saving, or a CRLF file would look like it
/// changed on every save.
pub fn hash_file_normalized(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let (decoded, _, _) = decode(&bytes);
    Some(hash_text(&normalize_newlines(&decoded)))
}

/// Read only the state of a file on disk, without decoding it.
pub fn stat_external(path: &Path) -> ExternalFileState {
    match fs::read(path) {
        Ok(bytes) => {
            let meta = fs::metadata(path).ok();
            let (decoded, _, _) = decode(&bytes);
            let content = normalize_newlines(&decoded);
            ExternalFileState {
                path: path.to_string_lossy().into_owned(),
                exists: true,
                size: meta.as_ref().map(|m| m.len()).unwrap_or(bytes.len() as u64),
                modified_ms: meta.as_ref().map(modified_ms).unwrap_or_else(now_ms),
                hash: hash_text(&content),
            }
        }
        Err(_) => ExternalFileState {
            path: path.to_string_lossy().into_owned(),
            exists: false,
            size: 0,
            modified_ms: 0,
            hash: String::new(),
        },
    }
}

fn unique_temp_path(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "untitled".into());
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let suffix = format!("{}-{}-{}", std::process::id(), now_ms(), counter);
    parent.join(format!(".{name}.davinci-{suffix}.tmp"))
}

/// Replace a file's contents without ever leaving it half-written.
///
/// The bytes are flushed to a sibling temp file, the original permissions are
/// carried over, and only then is the temp file renamed onto the target.
pub fn write_bytes_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    if !parent.exists() {
        return Err(AppError::new(
            ErrorCode::NotFound,
            "The folder this file lives in no longer exists.",
        )
        .with_path(&parent));
    }

    let temp = unique_temp_path(target);

    {
        use std::io::Write;
        let mut file = fs::File::create(&temp).map_err(|e| AppError::from_io(&e, &temp))?;
        file.write_all(bytes)
            .map_err(|e| AppError::from_io(&e, &temp))?;
        // Durability: without this a power loss can leave an empty file behind.
        file.sync_all().map_err(|e| AppError::from_io(&e, &temp))?;
    }

    if let Ok(existing) = fs::metadata(target) {
        let _ = fs::set_permissions(&temp, existing.permissions());
    }

    if let Err(err) = fs::rename(&temp, target) {
        let _ = fs::remove_file(&temp);
        return Err(AppError::from_io(&err, target));
    }

    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOptions {
    pub encoding: Option<String>,
    pub eol: Option<String>,
    pub bom: Option<bool>,
    /// SHA-256 of the content the editor loaded. When it no longer matches the
    /// file on disk the write is refused so external edits are never clobbered.
    pub expected_hash: Option<String>,
}

pub fn write_text_document(
    path: &Path,
    content: &str,
    options: &WriteOptions,
) -> Result<TextDocument> {
    if let Some(expected) = options.expected_hash.as_deref() {
        if path.exists() {
            let current = fs::read(path).map_err(|e| AppError::from_io(&e, path))?;
            let (decoded, _, _) = decode(&current);
            let disk_hash = hash_text(&normalize_newlines(&decoded));
            if disk_hash != expected {
                return Err(AppError::new(
                    ErrorCode::Conflict,
                    "The file changed on disk since it was opened. Reload it or save a copy.",
                )
                .with_path(path));
            }
        }
    }

    let encoding: &'static Encoding = match options.encoding.as_deref() {
        None | Some("") | Some("auto") => UTF_8,
        Some(label) => Encoding::for_label(label.as_bytes()).ok_or_else(|| {
            AppError::new(ErrorCode::Encoding, "That text encoding is not supported.")
                .with_path(path)
                .with_detail(label.to_string())
        })?,
    };

    let eol = options.eol.as_deref().unwrap_or("lf");
    let with_eol = apply_eol(content, eol);
    let want_bom = options.bom.unwrap_or(false);

    let bom_bytes = encoding_bom(encoding);
    let mut bytes: Vec<u8> = Vec::with_capacity(with_eol.len() + bom_bytes.len());
    if want_bom && !bom_bytes.is_empty() {
        bytes.extend_from_slice(bom_bytes);
    }

    let (encoded, _, _) = encoding.encode(&with_eol);
    // `Encoding::encode` prepends a BOM for the UTF-16 families; drop it when we
    // already wrote one so the file does not end up with two.
    let payload = if encoded.starts_with(bom_bytes) && !bom_bytes.is_empty() && want_bom {
        &encoded[bom_bytes.len()..]
    } else {
        &encoded[..]
    };
    bytes.extend_from_slice(payload);

    write_bytes_atomic(path, &bytes)?;

    // Re-read so the caller receives authoritative metadata.
    let mut doc = read_text_document(path)?;
    // Preserve the encoding the user explicitly chose even if detection would
    // label plain ASCII differently.
    doc.encoding = encoding.name().to_string();
    Ok(doc)
}

/// The BOM this encoding is written with, if any.
fn encoding_bom(encoding: &'static Encoding) -> &'static [u8] {
    if encoding == UTF_8 {
        &[0xEF, 0xBB, 0xBF]
    } else if encoding == UTF_16LE {
        &[0xFF, 0xFE]
    } else if encoding == UTF_16BE {
        &[0xFE, 0xFF]
    } else {
        &[]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_crlf_dominance() {
        assert_eq!(detect_eol("a\r\nb\r\nc"), "crlf");
        assert_eq!(detect_eol("a\nb\nc"), "lf");
        assert_eq!(detect_eol(""), "lf");
    }

    #[test]
    fn normalizes_mixed_endings() {
        assert_eq!(normalize_newlines("a\r\nb\rc\nd"), "a\nb\nc\nd");
    }

    #[test]
    fn applies_crlf() {
        assert_eq!(apply_eol("a\nb", "crlf"), "a\r\nb");
        assert_eq!(apply_eol("a\nb", "lf"), "a\nb");
    }

    #[test]
    fn hashes_are_stable() {
        assert_eq!(hash_text("hello"), hash_text("hello"));
        assert_ne!(hash_text("hello"), hash_text("hello "));
    }

    #[test]
    fn binary_sniff_rejects_nul_bytes() {
        assert!(looks_binary(&[0x00, 0x01, 0x02, 0x03]));
        assert!(!looks_binary(b"# plain markdown"));
    }

    #[test]
    fn bom_is_reported_and_stripped() {
        let bytes = [0xEF, 0xBB, 0xBF, b'h', b'i'];
        let (text, encoding, bom) = decode(&bytes);
        assert_eq!(text, "hi");
        assert_eq!(encoding, UTF_8);
        assert!(bom);
    }
}
