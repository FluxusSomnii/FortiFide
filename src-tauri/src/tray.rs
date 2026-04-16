use crate::capture::CaptureStatus;
use tauri::menu::MenuItem;
// Manager trait is imported in lib.rs — tray_by_id is available through AppHandle

/// Update the tray toggle menu item text and tooltip based on capture state.
/// When capturing: "Stop Capture". When idle/paused: "Start Capture".
pub fn update_toggle_item(toggle_item: &MenuItem<tauri::Wry>, status: &CaptureStatus) {
    let label = match status {
        CaptureStatus::Capturing => "Stop Capture",
        CaptureStatus::Idle | CaptureStatus::Paused => "Start Capture",
    };

    let _ = toggle_item.set_text(label);
    println!("[TRAY] Status: {label}");
}

/// Update the tray icon tooltip based on capture state.
pub fn update_tray_tooltip(app: &tauri::AppHandle, status: &CaptureStatus) {
    let tooltip = match status {
        CaptureStatus::Capturing => "Fides — Observing",
        CaptureStatus::Idle => "Fides — Idle",
        CaptureStatus::Paused => "Fides — Paused",
    };

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
