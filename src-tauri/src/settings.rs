//! Persisted user settings and the last session.
//!
//! Both files live in the platform config directory so an application upgrade
//! keeps them, and both are written atomically. Every field is `#[serde(default)]`
//! so an older file keeps loading after new options are introduced, and an
//! unknown field from a newer file is ignored rather than fatal.

use crate::error::{AppError, Result};
use crate::filesystem::write_bytes_atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SETTINGS_FILE: &str = "settings.json";
pub const SESSION_FILE: &str = "session.json";
pub const RECENT_LIMIT: usize = 25;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RecentEntry {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AutosaveSettings {
    pub enabled: bool,
    /// Delay after the last keystroke, in milliseconds.
    pub delay_ms: u32,
    pub on_focus_lost: bool,
}

impl Default for AutosaveSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            delay_ms: 1500,
            on_focus_lost: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorSettings {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f32,
    pub tab_size: u32,
    /// Insert spaces instead of a tab character.
    pub insert_spaces: bool,
    pub word_wrap: bool,
    pub line_numbers: bool,
    pub highlight_active_line: bool,
    pub bracket_matching: bool,
    pub code_folding: bool,
    pub show_whitespace: bool,
    pub autosave: AutosaveSettings,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_family: "\"Cascadia Code\", \"JetBrains Mono\", \"Fira Code\", \"DejaVu Sans Mono\", Consolas, monospace"
                .to_string(),
            font_size: 14,
            line_height: 1.6,
            tab_size: 4,
            insert_spaces: true,
            word_wrap: true,
            line_numbers: true,
            highlight_active_line: true,
            bracket_matching: true,
            code_folding: true,
            show_whitespace: false,
            autosave: AutosaveSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PreviewSettings {
    /// `system` | `light` | `dark`
    pub theme: String,
    pub font_size: u32,
    pub sync_scroll: bool,
    /// `auto` or a Mermaid theme name.
    pub mermaid_theme: String,
    /// `auto` or a Shiki theme name.
    pub code_theme: String,
    /// Render raw HTML found in Markdown, after strict sanitisation.
    pub allow_raw_html: bool,
    pub render_math: bool,
    pub line_wrap_code: bool,
    /// Open `http(s)` links in the system browser instead of doing nothing.
    pub open_external_links: bool,
    /// Show the heading anchor button on hover.
    pub heading_anchors: bool,
}

impl Default for PreviewSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            font_size: 16,
            sync_scroll: true,
            mermaid_theme: "auto".into(),
            code_theme: "auto".into(),
            allow_raw_html: true,
            render_math: true,
            line_wrap_code: false,
            open_external_links: true,
            heading_anchors: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FilesSettings {
    pub restore_session: bool,
    pub recent_files: Vec<RecentEntry>,
    pub recent_workspaces: Vec<String>,
    /// `ask` | `autoReload` | `keepLocal`
    pub external_change: String,
    /// `preserve` | `lf` | `crlf` for newly created documents.
    pub default_eol: String,
    /// `auto` or a canonical encoding label.
    pub default_encoding: String,
    pub show_ignored: bool,
    pub extra_ignored: Vec<String>,
    pub confirm_delete: bool,
}

impl Default for FilesSettings {
    fn default() -> Self {
        Self {
            restore_session: true,
            recent_files: Vec::new(),
            recent_workspaces: Vec::new(),
            external_change: "ask".into(),
            default_eol: "lf".into(),
            default_encoding: "UTF-8".into(),
            show_ignored: false,
            extra_ignored: Vec::new(),
            confirm_delete: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ApplicationSettings {
    /// `system` | `light` | `dark` for the whole shell.
    pub theme: String,
    /// UI zoom factor applied to the shell.
    pub zoom: f32,
    /// `system` | `en` | `ru`
    pub language: String,
    pub telemetry: bool,
}

impl Default for ApplicationSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            zoom: 1.0,
            language: "system".into(),
            // Telemetry is absent from the MVP; the flag exists only so the
            // contract is explicit and auditable.
            telemetry: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ViewSettings {
    /// `editor` | `preview` | `split-h` | `split-v`
    pub layout: String,
    /// Share of the width/height given to the editor in split mode.
    pub split_ratio: f32,
    pub show_explorer: bool,
    pub show_outline: bool,
    pub explorer_width: u32,
    pub outline_width: u32,
}

impl Default for ViewSettings {
    fn default() -> Self {
        Self {
            layout: "split-v".into(),
            split_ratio: 0.5,
            show_explorer: true,
            show_outline: false,
            explorer_width: 260,
            outline_width: 240,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub preview: PreviewSettings,
    #[serde(default)]
    pub files: FilesSettings,
    #[serde(default)]
    pub application: ApplicationSettings,
    #[serde(default)]
    pub view: ViewSettings,
}

impl Settings {
    /// Clamp values that arrive from a hand-edited file so the UI never has to
    /// defend against, say, a font size of 4000.
    pub fn sanitize(&mut self) {
        self.editor.font_size = self.editor.font_size.clamp(8, 72);
        self.editor.tab_size = self.editor.tab_size.clamp(1, 16);
        self.editor.line_height = self.editor.line_height.clamp(1.0, 3.0);
        self.editor.autosave.delay_ms = self.editor.autosave.delay_ms.clamp(200, 600_000);
        self.editor.font_family = self.editor.font_family.trim().to_string();
        if self.editor.font_family.is_empty() {
            self.editor.font_family = EditorSettings::default().font_family;
        }

        self.preview.font_size = self.preview.font_size.clamp(10, 48);
        if !matches!(self.preview.theme.as_str(), "system" | "light" | "dark") {
            self.preview.theme = "system".into();
        }
        if !matches!(
            self.preview.mermaid_theme.as_str(),
            "auto" | "default" | "dark" | "forest" | "neutral" | "base"
        ) {
            self.preview.mermaid_theme = "auto".into();
        }

        self.application.zoom = self.application.zoom.clamp(0.5, 3.0);
        if !matches!(self.application.theme.as_str(), "system" | "light" | "dark") {
            self.application.theme = "system".into();
        }

        if !matches!(
            self.view.layout.as_str(),
            "editor" | "preview" | "split-h" | "split-v"
        ) {
            self.view.layout = "split-v".into();
        }
        self.view.split_ratio = self.view.split_ratio.clamp(0.15, 0.85);
        self.view.explorer_width = self.view.explorer_width.clamp(150, 800);
        self.view.outline_width = self.view.outline_width.clamp(150, 800);

        if !matches!(
            self.files.external_change.as_str(),
            "ask" | "autoReload" | "keepLocal"
        ) {
            self.files.external_change = "ask".into();
        }
        if !matches!(self.files.default_eol.as_str(), "preserve" | "lf" | "crlf") {
            self.files.default_eol = "lf".into();
        }

        self.files.extra_ignored.truncate(64);
        self.files.recent_files.truncate(RECENT_LIMIT);
        self.files.recent_workspaces.truncate(RECENT_LIMIT);
    }

    pub fn touch_recent_file(&mut self, path: &Path) {
        let key = path.to_string_lossy().into_owned();
        let name = crate::paths::file_name_or_path(path);
        self.files.recent_files.retain(|entry| entry.path != key);
        self.files.recent_files.insert(
            0,
            RecentEntry {
                path: key,
                name,
                opened_at: now_ms(),
            },
        );
        self.files.recent_files.truncate(RECENT_LIMIT);
    }

    pub fn touch_recent_workspace(&mut self, path: &Path) {
        let key = path.to_string_lossy().into_owned();
        self.files.recent_workspaces.retain(|entry| entry != &key);
        self.files.recent_workspaces.insert(0, key);
        self.files.recent_workspaces.truncate(RECENT_LIMIT);
    }

    pub fn forget_recent_file(&mut self, path: &str) {
        self.files.recent_files.retain(|entry| entry.path != path);
    }
}

/// One entry in the restored session: which document, where the caret was.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionDocument {
    pub path: String,
    #[serde(default)]
    pub cursor_line: u32,
    #[serde(default)]
    pub cursor_col: u32,
    #[serde(default)]
    pub scroll_top: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    #[serde(default)]
    pub documents: Vec<SessionDocument>,
    #[serde(default)]
    pub active_index: usize,
    #[serde(default)]
    pub workspace_root: Option<String>,
}

/// Loads and saves `settings.json` / `session.json` in the app config dir.
pub struct SettingsStore {
    dir: PathBuf,
    settings_path: PathBuf,
    session_path: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            settings_path: dir.join(SETTINGS_FILE),
            session_path: dir.join(SESSION_FILE),
            dir,
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn load(&self) -> Settings {
        let mut settings = match std::fs::read_to_string(&self.settings_path) {
            Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
                Ok(parsed) => parsed,
                Err(err) => {
                    log::warn!("settings.json is not readable, falling back to defaults: {err}");
                    // Preserve the damaged file instead of silently overwriting it.
                    let backup = self
                        .dir
                        .join(format!("{SETTINGS_FILE}.corrupt-{}", now_ms()));
                    let _ = std::fs::rename(&self.settings_path, backup);
                    Settings::default()
                }
            },
            Err(_) => Settings::default(),
        };
        settings.sanitize();
        settings
    }

    pub fn save(&self, settings: &Settings) -> Result<()> {
        std::fs::create_dir_all(&self.dir).map_err(|e| AppError::from_io(&e, &self.dir))?;
        let body = serde_json::to_vec_pretty(settings).map_err(|e| {
            AppError::internal("Settings could not be serialised.").with_detail(e.to_string())
        })?;
        write_bytes_atomic(&self.settings_path, &body)
    }

    pub fn load_session(&self) -> Session {
        match std::fs::read_to_string(&self.session_path) {
            Ok(raw) => serde_json::from_str::<Session>(&raw).unwrap_or_default(),
            Err(_) => Session::default(),
        }
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        std::fs::create_dir_all(&self.dir).map_err(|e| AppError::from_io(&e, &self.dir))?;
        let body = serde_json::to_vec_pretty(session).map_err(|e| {
            AppError::internal("Session could not be serialised.").with_detail(e.to_string())
        })?;
        write_bytes_atomic(&self.session_path, &body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let partial = r#"{ "editor": { "fontSize": 20 } }"#;
        let settings: Settings = serde_json::from_str(partial).expect("partial settings parse");
        assert_eq!(settings.editor.font_size, 20);
        assert_eq!(settings.editor.tab_size, 4);
        assert!(settings.preview.render_math);
    }

    #[test]
    fn sanitize_clamps_hostile_values() {
        let mut settings = Settings::default();
        settings.editor.font_size = 5000;
        settings.view.split_ratio = 9.0;
        settings.preview.theme = "neon".into();
        settings.sanitize();
        assert_eq!(settings.editor.font_size, 72);
        assert_eq!(settings.view.split_ratio, 0.85);
        assert_eq!(settings.preview.theme, "system");
    }

    #[test]
    fn recent_files_are_deduplicated_and_bounded() {
        let mut settings = Settings::default();
        for index in 0..(RECENT_LIMIT + 10) {
            settings.touch_recent_file(Path::new(&format!("/tmp/doc{index}.md")));
        }
        assert_eq!(settings.files.recent_files.len(), RECENT_LIMIT);
        settings.touch_recent_file(Path::new("/tmp/doc19.md"));
        assert_eq!(settings.files.recent_files[0].path, "/tmp/doc19.md");
        assert_eq!(
            settings
                .files
                .recent_files
                .iter()
                .filter(|e| e.path == "/tmp/doc19.md")
                .count(),
            1
        );
    }

    #[test]
    fn settings_round_trip_through_json() {
        let settings = Settings::default();
        let encoded = serde_json::to_string(&settings).expect("serialize");
        let decoded: Settings = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(settings, decoded);
    }
}
