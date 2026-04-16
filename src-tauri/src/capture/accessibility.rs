use std::fmt;

#[derive(Debug)]
pub enum CaptureError {
    NotAvailable(String),
    PermissionDenied(String),
    ExtractionFailed(String),
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CaptureError::NotAvailable(msg) => write!(f, "Not available: {msg}"),
            CaptureError::PermissionDenied(msg) => write!(f, "Permission denied: {msg}"),
            CaptureError::ExtractionFailed(msg) => write!(f, "Extraction failed: {msg}"),
        }
    }
}

pub trait AccessibilityCapture {
    fn capture_text(&self) -> Result<String, CaptureError>;
}

/// Get text from the currently focused window using OS accessibility APIs.
/// Falls back gracefully: returns empty string if APIs are unavailable.
pub fn get_focused_window_text() -> Result<String, CaptureError> {
    #[cfg(target_os = "windows")]
    {
        return windows_get_focused_text();
    }

    #[cfg(target_os = "macos")]
    {
        return macos_get_focused_text();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(CaptureError::NotAvailable(
            "Accessibility capture not implemented for this platform".to_string(),
        ))
    }
}

// ─── Windows: UI Automation API ───

#[cfg(target_os = "windows")]
fn windows_get_focused_text() -> Result<String, CaptureError> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
    };
    use windows::core::Interface;

    unsafe {
        // Initialize COM (needed for UI Automation)
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let result = (|| -> Result<String, CaptureError> {
            // Create UI Automation instance
            let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL)
                .map_err(|e| {
                    CaptureError::NotAvailable(format!("Failed to create IUIAutomation: {e}"))
                })?;

            // Get focused element
            let focused = automation.GetFocusedElement().map_err(|e| {
                CaptureError::ExtractionFailed(format!("GetFocusedElement failed: {e}"))
            })?;

            let mut text_parts: Vec<String> = Vec::new();

            // First: get Name property of focused element
            if let Ok(name) = focused.CurrentName() {
                let name_str = name.to_string();
                if !name_str.is_empty() {
                    text_parts.push(name_str);
                }
            }

            // Second: try to get text pattern (for text fields, documents)
            if let Ok(pattern) = focused.GetCurrentPattern(UIA_TextPatternId) {
                if let Ok(text_pattern) = pattern.cast::<IUIAutomationTextPattern>() {
                    if let Ok(range) = text_pattern.DocumentRange() {
                        if let Ok(text) = range.GetText(-1) {
                            let text_str = text.to_string();
                            if !text_str.is_empty() {
                                text_parts.push(text_str);
                            }
                        }
                    }
                }
            }

            // Third: walk immediate children for text content
            if let Ok(walker) = automation.ControlViewWalker() {
                collect_child_text(&walker, &focused, &mut text_parts, 3);
            }

            let result = text_parts.join("\n");
            Ok(result)
        })();

        CoUninitialize();
        result
    }
}

#[cfg(target_os = "windows")]
unsafe fn collect_child_text(
    walker: &windows::Win32::UI::Accessibility::IUIAutomationTreeWalker,
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    text_parts: &mut Vec<String>,
    max_depth: u32,
) {
    if max_depth == 0 {
        return;
    }

    let child = match walker.GetFirstChildElement(element) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut current = Some(child);
    let mut count = 0;

    while let Some(ref elem) = current {
        if count > 50 {
            break; // Safety limit
        }

        if let Ok(name) = elem.CurrentName() {
            let name_str = name.to_string();
            if !name_str.is_empty() && name_str.len() > 2 {
                text_parts.push(name_str);
            }
        }

        // Recurse into children
        collect_child_text(walker, elem, text_parts, max_depth - 1);

        // Move to next sibling
        current = walker.GetNextSiblingElement(elem).ok();
        count += 1;
    }
}

// ─── macOS: AppleScript via osascript ───

#[cfg(target_os = "macos")]
fn macos_get_focused_text() -> Result<String, CaptureError> {
    use std::process::Command;

    let output = Command::new("osascript")
        .args([
            "-e",
            r#"
            tell application "System Events"
                set frontApp to first application process whose frontmost is true
                set appName to name of frontApp

                -- Try to get all text elements from the focused window
                try
                    set theWindow to front window of frontApp
                    set allText to ""

                    -- Get all static text and text fields
                    set textElements to every static text of theWindow
                    repeat with t in textElements
                        set allText to allText & (value of t as text) & linefeed
                    end repeat

                    set textFields to every text field of theWindow
                    repeat with t in textFields
                        try
                            set allText to allText & (value of t as text) & linefeed
                        end try
                    end repeat

                    set textAreas to every text area of theWindow
                    repeat with t in textAreas
                        try
                            set allText to allText & (value of t as text) & linefeed
                        end try
                    end repeat

                    return allText
                on error
                    return ""
                end try
            end tell
            "#,
        ])
        .output()
        .map_err(|e| CaptureError::ExtractionFailed(format!("osascript failed: {e}")))?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(text.trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("not allowed") || err.contains("assistive") {
            Err(CaptureError::PermissionDenied(
                "Accessibility permission required. Grant it in System Preferences > Privacy & Security > Accessibility.".to_string(),
            ))
        } else {
            Err(CaptureError::ExtractionFailed(format!(
                "osascript error: {err}"
            )))
        }
    }
}
