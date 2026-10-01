//! DaVinci Markdown Editor — Tauri application entry point.

pub mod asset;
pub mod cli;
pub mod commands;
pub mod error;
pub mod filesystem;
pub mod links;
pub mod paths;
pub mod platform;
pub mod settings;
pub mod state;
pub mod watcher;
pub mod workspace;

use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

/// Emitted to the frontend when a second launch hands files to this instance.
pub const OPEN_PATHS_EVENT: &str = "app://open-paths";

/// Grace period before the window is forced visible even if the UI never
/// reports readiness. Prevents a webview failure from looking like "nothing
/// happened" when the user double-clicks a document.
const WINDOW_SHOW_FALLBACK: Duration = Duration::from_secs(5);

/// Never panics, unlike `println!`, which aborts when stdout is a detached
/// handle — exactly the situation in a Windows GUI build.
fn emit(text: &str) {
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    let _ = handle.write_all(text.as_bytes());
    let _ = handle.write_all(b"\n");
    let _ = handle.flush();
}

/// True when the process already has somewhere to write.
///
/// A GUI-subsystem process launched from a terminal has no standard handles at
/// all, but one launched with `>` or `|` does — and that handle must be left
/// alone, or a redirected `--version` would silently print to the console
/// instead of the caller's file.
#[cfg(windows)]
fn stdout_is_wired_up() -> bool {
    use windows_sys::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_UNKNOWN};
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_OUTPUT_HANDLE};

    let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    if handle.is_null() || handle as isize == -1 {
        return false;
    }
    // An unusable handle reports FILE_TYPE_UNKNOWN; a console, pipe or file all
    // report their own type.
    unsafe { GetFileType(handle) != FILE_TYPE_UNKNOWN }
}

#[cfg(windows)]
fn attach_parent_console() {
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        AttachConsole, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };

    // Never touch an inherited stdout: PowerShell capture, `>` redirection and
    // pipes all depend on it surviving untouched.
    if stdout_is_wired_up() {
        return;
    }

    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return;
        }
        let name: Vec<u16> = "CONOUT$\0".encode_utf16().collect();
        let handle = CreateFileW(
            name.as_ptr(),
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        );
        if handle.is_null() || handle as isize == -1 {
            return;
        }
        // Rust reads the process std handles lazily, so setting them here
        // (before any output) is enough for println!/eprintln! to reach the
        // console the user launched us from.
        SetStdHandle(STD_OUTPUT_HANDLE, handle);
        SetStdHandle(STD_ERROR_HANDLE, handle);
    }
}

#[cfg(not(windows))]
fn attach_parent_console() {}

pub fn run() {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    let args = cli::parse(&raw_args);

    if args.help || args.version {
        attach_parent_console();
        if args.help {
            emit(&cli::help_text());
        } else {
            emit(&cli::version_line());
        }
        return;
    }

    for unknown in &args.unknown {
        eprintln!("warning: unrecognised option '{unknown}' (see --help)");
    }

    let launch = cli::classify(&args.paths);

    let mut builder = tauri::Builder::default();

    // The single-instance plugin has to be registered first: it decides whether
    // this process becomes the primary instance.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        // argv[0] is the executable; the rest is the user's request.
        let forwarded = cli::parse(argv.iter().skip(1).map(String::as_str));
        let request = cli::classify(&forwarded.paths);
        commands::deliver_launch(app, request);
    }));

    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    builder = asset::register(builder);

    builder
        .setup(move |app| {
            let handle = app.handle().clone();

            let config_dir = handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from(".").join("davinci-markdown"));

            if let Err(err) = std::fs::create_dir_all(&config_dir) {
                log::warn!(
                    "cannot create the config directory {}: {err}",
                    config_dir.display()
                );
            }

            let app_state = state::AppState::new(settings::SettingsStore::new(config_dir));
            app_state.queue_launch(launch);
            app.manage(app_state);

            // The window has to exist before its webview settings can be
            // adjusted, and the frontend must not run before that happens.
            if let Some(window) = handle.get_webview_window("main") {
                platform::disable_browser_accelerator_keys(&window);
            }

            // Safety net: if the frontend never reports readiness, still show a
            // window rather than leaving the user with a silent process.
            let fallback_handle = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(WINDOW_SHOW_FALLBACK);
                let state = fallback_handle.state::<state::AppState>();
                if !state.is_frontend_ready() {
                    log::warn!("frontend did not report readiness; showing the window anyway");
                    if let Some(window) = fallback_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::take_launch_payload,
            commands::notify_frontend_ready,
            commands::show_main_window,
            commands::get_settings,
            commands::update_settings,
            commands::reset_settings,
            commands::get_session,
            commands::set_session,
            commands::forget_recent_file,
            commands::clear_recent,
            commands::read_document,
            commands::write_document,
            commands::write_export_file,
            commands::stat_file,
            commands::close_document,
            commands::path_info,
            commands::resolve_relative,
            commands::list_directory,
            commands::open_workspace,
            commands::close_workspace,
            commands::get_workspace,
            commands::create_file,
            commands::create_directory,
            commands::rename_entry,
            commands::delete_entry,
            commands::reveal_in_file_manager,
            commands::open_external_url,
            commands::pick_open_files,
            commands::pick_open_directory,
            commands::pick_save_path,
            commands::confirm_dialog,
            commands::prompt_unsaved,
            commands::app_info,
            commands::asset_access,
            commands::probe_asset,
            commands::read_asset_data_url,
            commands::print_document,
            commands::markdown_extensions,
        ])
        .run(tauri::generate_context!())
        .expect("the Tauri runtime could not be started");
}
