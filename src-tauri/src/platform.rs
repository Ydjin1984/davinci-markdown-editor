//! Platform-specific shell configuration.
//!
//! Everything here is about making the window behave like a desktop
//! application rather than a web page in a frame.

/// Turn off WebView2's built-in shortcut handling.
///
/// Without this, WebView2 keeps a set of browser accelerators of its own, and
/// they are not preventable from the page:
///
/// * `Ctrl+P` opens its print dialog before the application can switch to the
///   print layout, so the printed document keeps the screen colours — dark
///   text on dark paper.
/// * `Ctrl+R` and `F5` reload the page. Reloading discards the editor state;
///   the documents survive in the store, but it is not something a keystroke
///   should be able to do.
/// * `Ctrl+F` opens WebView2's find bar instead of the editor's own search.
///
/// WebKitGTK on Linux has no equivalent set, so nothing needs doing there.
#[cfg(windows)]
pub fn disable_browser_accelerator_keys<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface as _;

    let result = window.with_webview(|webview| {
        // Every step is optional: on an older WebView2 runtime the settings
        // interface may be missing, and that only means the accelerators stay
        // as they were.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(settings) = core.Settings() else {
                return;
            };
            let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() else {
                return;
            };
            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });

    if let Err(err) = result {
        log::warn!("could not disable the WebView2 accelerator keys: {err}");
    }
}

#[cfg(not(windows))]
pub fn disable_browser_accelerator_keys<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

/// Install a macOS application menu whose Quit item hands the request to the
/// frontend instead of terminating outright.
///
/// The default menu's Quit runs `NSApplication`'s `terminate:`, which bypasses
/// the webview entirely: the unsaved-changes prompt never runs and the
/// window's close handler is never called. `tao` does not implement
/// `applicationShouldTerminate:`, so there is no other place to intercept it.
/// This menu keeps every standard item (About, Services, Hide, the Edit and
/// Window menus) and swaps only Quit: the item emits `quit-requested` to the
/// webview, which runs the same save-and-confirm flow as closing the window
/// and then destroys the window — destroying the last window ends the process.
///
/// The function compiles on every platform (the menu API is portable); it is
/// installed only on macOS, where the default menu has the problem it fixes.
pub fn install_macos_quit_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::Emitter;

    let about = AboutMetadata {
        name: Some(app.package_info().name.clone()),
        version: Some(app.package_info().version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let quit = MenuItem::with_id(
        app.handle(),
        "app-quit",
        "Quit DaVinci Markdown Editor",
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let app_menu = Submenu::with_items(
        app.handle(),
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app.handle(), None, Some(about))?,
            &PredefinedMenuItem::separator(app.handle())?,
            &PredefinedMenuItem::services(app.handle(), None)?,
            &PredefinedMenuItem::separator(app.handle())?,
            &PredefinedMenuItem::hide(app.handle(), None)?,
            &PredefinedMenuItem::hide_others(app.handle(), None)?,
            &PredefinedMenuItem::separator(app.handle())?,
            &quit,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app.handle(),
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app.handle(), None)?],
    )?;

    let edit_menu = Submenu::with_items(
        app.handle(),
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app.handle(), None)?,
            &PredefinedMenuItem::redo(app.handle(), None)?,
            &PredefinedMenuItem::separator(app.handle())?,
            &PredefinedMenuItem::cut(app.handle(), None)?,
            &PredefinedMenuItem::copy(app.handle(), None)?,
            &PredefinedMenuItem::paste(app.handle(), None)?,
            &PredefinedMenuItem::select_all(app.handle(), None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app.handle(),
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app.handle(), None)?],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app.handle(),
        tauri::menu::WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app.handle(), None)?,
            &PredefinedMenuItem::maximize(app.handle(), None)?,
            &PredefinedMenuItem::separator(app.handle())?,
            &PredefinedMenuItem::close_window(app.handle(), None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app.handle(),
        tauri::menu::HELP_SUBMENU_ID,
        "Help",
        true,
        &[],
    )?;

    app.set_menu(Menu::with_items(
        app.handle(),
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?)?;

    app.on_menu_event(|app, event| {
        if event.id().0 == "app-quit" {
            let _ = app.emit(crate::QUIT_REQUESTED_EVENT, ());
        }
    });

    Ok(())
}
