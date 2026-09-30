//! Round-trip tests for reading and writing documents.
//!
//! These exercise the real filesystem rather than in-memory strings, because the
//! properties that matter here — encoding preservation, byte-exact line endings,
//! atomic replacement and conflict detection — only exist on disk.

use davinci_markdown_lib::error::ErrorCode;
use davinci_markdown_lib::filesystem::{self, WriteOptions};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A unique scratch directory, removed when the guard is dropped.
struct Scratch {
    path: PathBuf,
}

impl Scratch {
    fn new(label: &str) -> Self {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "davinci-test-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create scratch directory");
        Self { path }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    fn write_raw(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.file(name);
        fs::write(&path, bytes).expect("write fixture");
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn options(eol: &str, encoding: &str, bom: bool) -> WriteOptions {
    WriteOptions {
        encoding: Some(encoding.to_string()),
        eol: Some(eol.to_string()),
        bom: Some(bom),
        expected_hash: None,
    }
}

fn utf8_lf() -> WriteOptions {
    options("lf", "UTF-8", false)
}

#[test]
fn reads_utf8_without_bom() {
    let scratch = Scratch::new("utf8");
    let path = scratch.write_raw("a.md", "# Заголовок\n\nText\n".as_bytes());

    let document = filesystem::read_text_document(&path).expect("read");

    assert_eq!(document.content, "# Заголовок\n\nText\n");
    assert_eq!(document.eol, "lf");
    assert!(!document.bom);
    assert_eq!(document.encoding, "UTF-8");
    assert_eq!(document.name, "a.md");
}

#[test]
fn strips_a_utf8_bom_and_remembers_it() {
    let scratch = Scratch::new("bom");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("# Title\n".as_bytes());
    let path = scratch.write_raw("bom.md", &bytes);

    let document = filesystem::read_text_document(&path).expect("read");
    assert!(document.bom);
    // The BOM must not survive into the editable text.
    assert_eq!(document.content, "# Title\n");

    // Saving restores it.
    filesystem::write_text_document(&path, &document.content, &options("lf", "UTF-8", true))
        .expect("write");
    let raw = fs::read(&path).expect("reread");
    assert_eq!(&raw[..3], &[0xEF, 0xBB, 0xBF]);
}

#[test]
fn normalises_crlf_in_memory_and_restores_it_on_save() {
    let scratch = Scratch::new("crlf");
    let path = scratch.write_raw("crlf.md", b"one\r\ntwo\r\nthree\r\n");

    let document = filesystem::read_text_document(&path).expect("read");
    assert_eq!(document.eol, "crlf");
    // In-memory text is always LF so editor offsets stay stable.
    assert_eq!(document.content, "one\ntwo\nthree\n");

    filesystem::write_text_document(&path, &document.content, &options("crlf", "UTF-8", false))
        .expect("write");

    let raw = fs::read(&path).expect("reread");
    assert_eq!(raw, b"one\r\ntwo\r\nthree\r\n");
}

#[test]
fn converts_line_endings_when_asked() {
    let scratch = Scratch::new("eol-convert");
    let path = scratch.write_raw("lf.md", b"a\nb\n");

    filesystem::write_text_document(&path, "a\nb\n", &options("crlf", "UTF-8", false))
        .expect("write");
    assert_eq!(fs::read(&path).expect("reread"), b"a\r\nb\r\n");

    filesystem::write_text_document(&path, "a\r\nb\r\n", &options("lf", "UTF-8", false))
        .expect("write");
    assert_eq!(fs::read(&path).expect("reread"), b"a\nb\n");
}

#[test]
fn preserves_a_legacy_encoding() {
    let scratch = Scratch::new("cp1251");

    // "Привет" in windows-1251.
    let encoded: Vec<u8> = vec![0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2];
    let path = scratch.write_raw("ru.md", &encoded);

    let document = filesystem::read_text_document(&path).expect("read");
    assert_eq!(document.content, "Привет");
    assert_eq!(document.encoding, "windows-1251");

    filesystem::write_text_document(&path, "Пока", &options("lf", "windows-1251", false))
        .expect("write");
    assert_eq!(
        fs::read(&path).expect("reread"),
        vec![0xCF, 0xEE, 0xEA, 0xE0]
    );
}

#[test]
fn refuses_a_binary_file() {
    let scratch = Scratch::new("binary");
    let path = scratch.write_raw("blob.md", &[0x00, 0x01, 0x02, 0x03, 0xFF]);

    let error = filesystem::read_text_document(&path).expect_err("binary should be refused");
    assert_eq!(error.code, ErrorCode::Unsupported);
}

#[test]
fn reports_a_missing_file_as_not_found() {
    let scratch = Scratch::new("missing");
    let error = filesystem::read_text_document(&scratch.file("nope.md")).expect_err("should fail");
    assert_eq!(error.code, ErrorCode::NotFound);
}

#[test]
fn refuses_to_read_a_directory() {
    let scratch = Scratch::new("dir");
    let error = filesystem::read_text_document(&scratch.path).expect_err("should fail");
    assert_eq!(error.code, ErrorCode::IsADirectory);
}

#[test]
fn writing_creates_a_file_that_reads_back_identically() {
    let scratch = Scratch::new("roundtrip");
    let path = scratch.file("new.md");

    let content = "# Title\n\n- [x] task\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    let written = filesystem::write_text_document(&path, content, &utf8_lf()).expect("write");
    let read = filesystem::read_text_document(&path).expect("read");

    assert_eq!(read.content, content);
    assert_eq!(read.hash, written.hash);
    assert_eq!(written.hash, filesystem::hash_text(content));
}

#[test]
fn no_temporary_file_is_left_behind() {
    let scratch = Scratch::new("temp-cleanup");
    let path = scratch.write_raw("a.md", b"before\n");

    filesystem::write_text_document(&path, "after\n", &utf8_lf()).expect("write");

    let leftovers: Vec<String> = fs::read_dir(&scratch.path)
        .expect("list")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("davinci") || name.ends_with(".tmp"))
        .collect();

    assert!(
        leftovers.is_empty(),
        "temporary files remain: {leftovers:?}"
    );
}

#[test]
fn writing_preserves_the_target_path_only() {
    let scratch = Scratch::new("no-clobber");
    let neighbour = scratch.write_raw("other.md", b"untouched\n");
    let target = scratch.write_raw("target.md", b"old\n");

    filesystem::write_text_document(&target, "new\n", &utf8_lf()).expect("write");

    assert_eq!(
        fs::read(&neighbour).expect("read neighbour"),
        b"untouched\n"
    );
    assert_eq!(fs::read(&target).expect("read target"), b"new\n");
}

#[test]
fn a_matching_expected_hash_allows_the_write() {
    let scratch = Scratch::new("conflict-ok");
    let path = scratch.write_raw("a.md", b"first\n");

    let document = filesystem::read_text_document(&path).expect("read");
    let write = WriteOptions {
        encoding: Some("UTF-8".into()),
        eol: Some("lf".into()),
        bom: Some(false),
        expected_hash: Some(document.hash),
    };

    filesystem::write_text_document(&path, "second\n", &write).expect("write should be allowed");
    assert_eq!(fs::read(&path).expect("read"), b"second\n");
}

#[test]
fn a_stale_expected_hash_is_refused() {
    let scratch = Scratch::new("conflict-blocked");
    let path = scratch.write_raw("a.md", b"first\n");

    let document = filesystem::read_text_document(&path).expect("read");

    // Somebody else edits the file after we loaded it.
    fs::write(&path, b"theirs\n").expect("external write");

    let write = WriteOptions {
        encoding: Some("UTF-8".into()),
        eol: Some("lf".into()),
        bom: Some(false),
        expected_hash: Some(document.hash),
    };

    let error = filesystem::write_text_document(&path, "mine\n", &write)
        .expect_err("write should be refused");
    assert_eq!(error.code, ErrorCode::Conflict);
    // The other program's content is intact.
    assert_eq!(fs::read(&path).expect("read"), b"theirs\n");
}

#[test]
fn an_unreadable_hash_is_not_checked_on_a_new_file() {
    let scratch = Scratch::new("conflict-new");
    let path = scratch.file("brand-new.md");

    let write = WriteOptions {
        encoding: Some("UTF-8".into()),
        eol: Some("lf".into()),
        bom: Some(false),
        expected_hash: Some("a-hash-we-invented".into()),
    };

    filesystem::write_text_document(&path, "hello\n", &write)
        .expect("creating a file must not conflict");
    assert_eq!(fs::read(&path).expect("read"), b"hello\n");
}

#[test]
fn an_unknown_encoding_is_rejected() {
    let scratch = Scratch::new("bad-encoding");
    let path = scratch.file("a.md");

    let error =
        filesystem::write_text_document(&path, "x", &options("lf", "not-a-real-charset", false))
            .expect_err("should fail");
    assert_eq!(error.code, ErrorCode::Encoding);
    assert!(
        !path.exists(),
        "a failed write must not leave a file behind"
    );
}

#[test]
fn external_state_tracks_content_not_timestamps() {
    let scratch = Scratch::new("external");
    let path = scratch.write_raw("a.md", b"same\r\ncontent\r\n");

    let crlf = filesystem::stat_external(&path);
    assert!(crlf.exists);

    // The same content with LF endings hashes identically, so a rewrite that
    // only changes line endings is not reported as an external edit.
    fs::write(&path, b"same\ncontent\n").expect("rewrite");
    let lf = filesystem::stat_external(&path);

    assert_eq!(crlf.hash, lf.hash);
    assert_eq!(
        filesystem::hash_file_normalized(&path),
        Some(lf.hash.clone())
    );
}

#[test]
fn external_state_reports_a_removed_file() {
    let scratch = Scratch::new("removed");
    let path = scratch.write_raw("a.md", b"x\n");

    fs::remove_file(&path).expect("remove");

    let state = filesystem::stat_external(&path);
    assert!(!state.exists);
    assert!(filesystem::hash_file_normalized(&path).is_none());
}

#[test]
fn unicode_paths_work_end_to_end() {
    let scratch = Scratch::new("unicode");
    let path = scratch.file("Мои документы — заметка.md");

    filesystem::write_text_document(&path, "# Привет\n", &utf8_lf()).expect("write");
    let document = filesystem::read_text_document(&path).expect("read");

    assert_eq!(document.content, "# Привет\n");
    assert!(document.path.contains("заметка.md"));
}

#[test]
fn a_path_with_spaces_works_end_to_end() {
    let scratch = Scratch::new("spaces");
    let nested = scratch.path.join("My Documents");
    fs::create_dir_all(&nested).expect("create nested");
    let path = nested.join("some notes.md");

    filesystem::write_text_document(&path, "body\n", &utf8_lf()).expect("write");
    assert_eq!(
        filesystem::read_text_document(&path).expect("read").content,
        "body\n"
    );
}

#[test]
fn concurrent_writes_leave_a_complete_file() {
    let scratch = Scratch::new("concurrent");
    let path = scratch.write_raw("a.md", b"start\n");

    let payload: String = "x".repeat(200_000);
    let mut handles = Vec::new();
    for _ in 0..8 {
        let path = path.clone();
        let payload = payload.clone();
        handles.push(std::thread::spawn(move || {
            let _ = filesystem::write_text_document(&path, &payload, &utf8_lf());
        }));
    }
    for handle in handles {
        handle.join().expect("thread");
    }

    // Whichever writer won, the file must be complete rather than interleaved.
    let final_content = filesystem::read_text_document(&path).expect("read").content;
    assert_eq!(final_content.len(), payload.len());
    assert!(final_content.chars().all(|c| c == 'x'));
}

#[test]
fn hash_file_normalized_matches_the_document_hash() {
    let scratch = Scratch::new("hash-match");
    // CRLF on disk, and the hash must still equal the normalised content hash —
    // this is what lets the watcher recognise the application's own saves.
    let path = scratch.write_raw("a.md", b"one\r\ntwo\r\n");

    let document = filesystem::read_text_document(&path).expect("read");
    assert_eq!(filesystem::hash_file_normalized(&path), Some(document.hash));
}

#[test]
fn read_only_detection_reflects_the_filesystem() {
    let scratch = Scratch::new("readonly");
    let path = scratch.write_raw("a.md", b"x\n");

    let document = filesystem::read_text_document(&path).expect("read");
    // Windows and Linux both mark a read-only file through permissions; the
    // exact flag differs, so only the round trip is asserted here.
    let _ = document.read_only;

    let mut permissions = fs::metadata(&path).expect("metadata").permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).expect("set readonly");

    assert!(
        filesystem::read_text_document(&path)
            .expect("read")
            .read_only
    );

    // Leave the file writable so the scratch directory can be removed.
    let mut permissions = fs::metadata(&path).expect("metadata").permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(&path, permissions).expect("restore permissions");
}

#[test]
fn empty_files_are_valid_documents() {
    let scratch = Scratch::new("empty");
    let path = scratch.write_raw("empty.md", b"");

    let document = filesystem::read_text_document(&path).expect("read");
    assert_eq!(document.content, "");
    assert_eq!(document.line_count, 1);
}

#[test]
fn paths_outside_the_scratch_are_not_touched() {
    let scratch = Scratch::new("containment");
    let outside = scratch.file("outside.txt");
    fs::write(&outside, b"keep").expect("write");

    let inside = scratch.file("inside.md");
    filesystem::write_text_document(&inside, "x", &utf8_lf()).expect("write");

    assert_eq!(fs::read(&outside).expect("read"), b"keep");
    assert!(Path::new(&inside).exists());
}
