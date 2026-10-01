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
