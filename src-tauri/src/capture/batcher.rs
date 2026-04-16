use std::time::Instant;

/// Adaptive text batcher for captured content.
///
/// Heuristic:
/// - If text was pushed in the last minute (active reading): flush every 45 seconds.
/// - If no pushes in the last minute (idle): flush every 300 seconds (5 minutes).
/// - `should_flush()` returns true when time since last flush exceeds the current interval.
pub struct TextBatcher {
    buffer: Vec<String>,
    last_push: Option<Instant>,
    last_flush: Instant,
    pushes_in_last_minute: u32,
    last_minute_check: Instant,
}

const ACTIVE_FLUSH_SECS: u64 = 45;
const IDLE_FLUSH_SECS: u64 = 300;
const MINUTE_SECS: u64 = 60;

impl TextBatcher {
    pub fn new() -> Self {
        let now = Instant::now();
        Self {
            buffer: Vec::new(),
            last_push: None,
            last_flush: now,
            pushes_in_last_minute: 0,
            last_minute_check: now,
        }
    }

    pub fn push(&mut self, text: String) {
        self.buffer.push(text);
        self.last_push = Some(Instant::now());
        self.update_push_count();
    }

    pub fn should_flush(&mut self) -> bool {
        if self.buffer.is_empty() {
            return false;
        }

        self.update_push_count();

        let interval_secs = if self.pushes_in_last_minute > 0 {
            ACTIVE_FLUSH_SECS
        } else {
            IDLE_FLUSH_SECS
        };

        self.last_flush.elapsed().as_secs() >= interval_secs
    }

    pub fn flush(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }

        let combined = self.buffer.join("\n");
        self.buffer.clear();
        self.last_flush = Instant::now();
        Some(combined)
    }

    fn update_push_count(&mut self) {
        let now = Instant::now();
        if now.duration_since(self.last_minute_check).as_secs() >= MINUTE_SECS {
            // Reset the counter for the new minute window
            self.pushes_in_last_minute = 0;
            self.last_minute_check = now;
        }

        // Count this push if called from push()
        if let Some(lp) = self.last_push {
            if now.duration_since(lp).as_secs() < MINUTE_SECS {
                self.pushes_in_last_minute = self.pushes_in_last_minute.saturating_add(1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_batcher_does_not_flush() {
        let mut batcher = TextBatcher::new();
        assert!(!batcher.should_flush());
        assert!(batcher.flush().is_none());
    }

    #[test]
    fn flush_returns_combined_text() {
        let mut batcher = TextBatcher::new();
        batcher.push("hello".to_string());
        batcher.push("world".to_string());
        let result = batcher.flush();
        assert_eq!(result, Some("hello\nworld".to_string()));
        assert!(batcher.flush().is_none());
    }
}
