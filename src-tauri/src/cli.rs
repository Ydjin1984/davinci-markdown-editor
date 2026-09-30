//! Command line handling.
//!
//! `davinci-markdown README.md docs/` must behave on Windows and Linux alike,
//! and the same parser is reused for the second-instance hand-off where the OS
//! launches a new process just to deliver file arguments.

use std::path::{Path, PathBuf};

pub const BIN_NAME: &str = "davinci-markdown";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CliArgs {
    /// Files and folders, in the order the OS supplied them.
    pub paths: Vec<String>,
    /// Accepted for forward compatibility; multi-window is a Phase 2 feature.
    pub new_window: bool,
    pub help: bool,
    pub version: bool,
    pub unknown: Vec<String>,
}

/// Split raw arguments (excluding argv[0]) into a structured request.
pub fn parse<I, S>(args: I) -> CliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut parsed = CliArgs::default();
    let mut literal = false;

    for arg in args {
        let arg = arg.as_ref();

        if literal {
            parsed.paths.push(arg.to_string());
            continue;
        }

        match arg {
            "--" => literal = true,
            "-h" | "--help" => parsed.help = true,
            "-V" | "--version" => parsed.version = true,
            "--new-window" => parsed.new_window = true,
            other if other.starts_with("--") => parsed.unknown.push(other.to_string()),
            // A single dash or a Windows path such as `-weird.md` is still a path.
            other if other.starts_with('-') && other.len() > 1 && !is_existing_path(other) => {
                parsed.unknown.push(other.to_string());
            }
            other if !other.is_empty() => parsed.paths.push(other.to_string()),
            _ => {}
        }
    }

    parsed
}

fn is_existing_path(candidate: &str) -> bool {
    Path::new(candidate).exists()
}

/// A launch request after the paths have been classified.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LaunchRequest {
    pub files: Vec<PathBuf>,
    /// The first directory argument, if any, becomes the workspace.
    pub workspace: Option<PathBuf>,
}

/// Separate file arguments from a folder argument.
///
/// Paths are returned absolute and lexically normalised so the hand-off between
/// processes cannot be confused by a differing working directory.
pub fn classify(paths: &[String]) -> LaunchRequest {
    let mut request = LaunchRequest::default();
    let cwd = std::env::current_dir().ok();

    for raw in paths {
        let candidate = PathBuf::from(raw);
        let absolute = if candidate.is_absolute() {
            candidate
        } else if let Some(cwd) = cwd.as_ref() {
            cwd.join(&candidate)
        } else {
            candidate
        };
        let absolute = crate::paths::normalize_lexically(&absolute);

        if absolute.is_dir() {
            if request.workspace.is_none() {
                request.workspace = Some(absolute);
            }
        } else {
            request.files.push(absolute);
        }
    }

    request
}

pub fn version_line() -> String {
    format!("{BIN_NAME} {}", env!("CARGO_PKG_VERSION"))
}

pub fn help_text() -> String {
    format!(
        "\
{name} {version}
{description}

USAGE:
    {name} [OPTIONS] [PATH]...

ARGS:
    <PATH>...    Markdown files to open. A folder is opened as the workspace.

OPTIONS:
    -h, --help        Print this help and exit
    -V, --version     Print the version and exit
        --new-window  Open in a new window (accepted; single window for now)

EXAMPLES:
    {name} README.md
    {name} README.md CHANGELOG.md
    {name} ./docs/

Files opened while an instance is already running are handed to that instance
and appear as new tabs.",
        name = BIN_NAME,
        version = env!("CARGO_PKG_VERSION"),
        description = env!("CARGO_PKG_DESCRIPTION"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flags_and_paths() {
        let args = parse(["--help", "README.md"]);
        assert!(args.help);
        assert_eq!(args.paths, vec!["README.md"]);

        let args = parse(["-V"]);
        assert!(args.version);

        let args = parse(["--new-window", "a.md", "b.md"]);
        assert!(args.new_window);
        assert_eq!(args.paths, vec!["a.md", "b.md"]);
    }

    #[test]
    fn double_dash_stops_option_parsing() {
        let args = parse(["--", "--not-a-flag.md"]);
        assert_eq!(args.paths, vec!["--not-a-flag.md"]);
        assert!(args.unknown.is_empty());
    }

    #[test]
    fn unknown_long_flags_are_reported() {
        let args = parse(["--wat", "a.md"]);
        assert_eq!(args.unknown, vec!["--wat"]);
        assert_eq!(args.paths, vec!["a.md"]);
    }

    #[test]
    fn unicode_and_spaced_paths_survive() {
        let args = parse([r"C:\Мои документы\архитектура.md"]);
        assert_eq!(args.paths, vec![r"C:\Мои документы\архитектура.md"]);
    }

    #[test]
    fn empty_arguments_are_ignored() {
        let args = parse(["", "a.md", ""]);
        assert_eq!(args.paths, vec!["a.md"]);
    }
}
