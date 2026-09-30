// Release builds are GUI applications on Windows: no console window is created
// when the OS launches us from Explorer. The console is re-attached on demand in
// `run()` so `--help` and `--version` still work from a terminal.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    davinci_markdown_lib::run();
}
