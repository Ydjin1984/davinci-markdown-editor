//! Preview asset access policy.
//!
//! Layout used throughout:
//!
//! ```text
//! root/outside.png              <- ../../outside.png
//! root/images/far.png           <- ../../images/far.png
//! root/docs/images/near.png     <- ../images/near.png
//! root/docs/shared.png          <- ../shared.png
//! root/docs/guide/local.png     <- ./local.png
//! root/docs/guide/intro.md      <- the open document
//! ```

use davinci_markdown_lib::asset::AssetRoots;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

/// Tests run in parallel, so each fixture needs a directory of its own —
/// sharing one per process makes them delete each other's files mid-run.
static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new() -> Self {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("davinci-assets-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for dir in ["docs/guide", "docs/images", "images"] {
            fs::create_dir_all(root.join(dir)).expect("create directories");
        }
        for file in [
            "outside.png",
            "images/far.png",
            "docs/images/near.png",
            "docs/shared.png",
            "docs/guide/local.png",
            "docs/guide/intro.md",
            "docs/guide/notes.txt",
        ] {
            fs::write(root.join(file), b"x").expect("write file");
        }
        Self { root }
    }

    fn document(&self) -> PathBuf {
        self.root.join("docs/guide/intro.md")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn relative_links_climb_out_of_the_document_directory() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    // The whole point: `docs/guide/intro.md` referring to `../images/near.png`
    // or `../../images/far.png` is the normal repository layout.
    let allowed = [
        scratch.root.join("docs/guide/local.png"),
        scratch.root.join("docs/shared.png"),
        scratch.root.join("docs/images/near.png"),
        scratch.root.join("images/far.png"),
        scratch.root.join("outside.png"),
    ];

    for path in &allowed {
        assert!(
            assets.resolve(path).is_some(),
            "should be readable: {}",
            path.display()
        );
    }
}

#[test]
fn the_document_itself_is_registered() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    assert!(
        assets
            .describe()
            .iter()
            .any(|entry| entry.ends_with("intro.md")),
        "the opened file must be registered, not silently dropped"
    );
}

#[test]
fn unrelated_directories_stay_out_of_reach() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    let elsewhere = std::env::temp_dir().join(format!(
        "davinci-not-registered-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&elsewhere).expect("create");
    let stray = elsewhere.join("secret.png");
    fs::write(&stray, b"x").expect("write");

    assert!(
        assets.resolve(&stray).is_none(),
        "unregistered path must be refused"
    );

    let _ = fs::remove_dir_all(&elsewhere);
}

#[test]
fn a_filesystem_root_is_never_registered() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    // Registering `/` or `C:\` would hand the preview the entire disk.
    for root in assets.roots() {
        assert!(
            root.parent().is_some(),
            "a filesystem root was registered: {}",
            root.display()
        );
    }
}

#[test]
fn non_inline_extensions_are_refused_inside_an_allowed_root() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    // A document must not be able to turn the preview into a generic file
    // reader for the directory it happens to sit in.
    assert!(assets
        .resolve(&scratch.root.join("docs/guide/notes.txt"))
        .is_none());
    assert!(assets
        .resolve(&scratch.root.join("docs/guide/intro.md"))
        .is_none());
}

#[test]
fn closing_a_document_revokes_what_it_brought_into_scope() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    assert!(assets
        .resolve(&scratch.root.join("images/far.png"))
        .is_some());

    // `refresh_asset_roots` clears and re-registers; with no documents open and
    // no workspace, nothing should remain.
    assets.clear();

    assert!(assets
        .resolve(&scratch.root.join("images/far.png"))
        .is_none());
    assert!(assets.describe().is_empty());
}

#[test]
fn a_workspace_root_covers_the_documents_inside_it() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();

    // With a folder open the workspace root is the only thing needed.
    assets.allow_directory(&scratch.root);

    assert!(assets
        .resolve(&scratch.root.join("images/far.png"))
        .is_some());
    assert!(assets
        .resolve(&scratch.root.join("docs/guide/local.png"))
        .is_some());
}

#[test]
fn the_oldest_root_is_evicted_rather_than_new_ones_being_dropped() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();

    // Exceed the internal cap, then confirm the newest registration still works.
    for index in 0..200 {
        let dir = scratch.root.join(format!("generated/{index}"));
        fs::create_dir_all(&dir).expect("create");
        assets.allow_directory(&dir);
    }

    let image = scratch.root.join("generated/199/a.png");
    fs::write(&image, b"x").expect("write");

    assert!(
        assets.resolve(&image).is_some(),
        "the most recent registration must not be silently dropped"
    );
}

#[test]
fn describe_lists_what_the_preview_can_reach() {
    let scratch = Scratch::new();
    let assets = AssetRoots::new();
    assets.allow_document(&scratch.document());

    let described = assets.describe();
    assert!(described.iter().any(|entry| entry.ends_with("guide")));
    assert!(described.iter().any(|entry| entry.ends_with("docs")));

    // Deterministic and de-duplicated for the diagnostics dialog.
    let mut sorted = described.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(described, sorted);
}
