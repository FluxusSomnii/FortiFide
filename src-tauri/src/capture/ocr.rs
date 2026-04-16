use super::accessibility::CaptureError;

pub trait OcrCapture {
    fn capture_from_screenshot(&self, image_data: &[u8]) -> Result<String, CaptureError>;
}

pub struct StubOcrCapture;

impl OcrCapture for StubOcrCapture {
    fn capture_from_screenshot(&self, _image_data: &[u8]) -> Result<String, CaptureError> {
        // TODO: Implement OCR fallback. Options: tesseract-rs, or WASM-based OCR.
        Ok(String::new())
    }
}
