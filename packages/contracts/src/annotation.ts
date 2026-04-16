// BRIDGE CONTRACT — PRIVACY BOUNDARY
// The Reflection Pool NEVER receives source text, session file contents,
// or DetectionInstance objects through this interface.
// This interface emits signal quality metadata ONLY.
// Adding text content fields to AnnotationEvent would violate the
// privacy boundary between Fides and DreamOS. Do not add them.

/**
 * AnnotationEvent — the ONLY data type that crosses the Fides -> Reflection Pool bridge.
 *
 * HARD CONSTRAINT: The Reflection Pool receives AnnotationEvent ONLY.
 * It NEVER receives:
 * - Source text or captured screen content
 * - Session file contents
 * - Individual DetectionInstance objects
 * - User feedback data
 * - Pattern definitions or library entries
 *
 * The bridge is a ONE-WAY signal quality pipe. Nothing else crosses it.
 * This is a privacy and architectural boundary, not an optimization choice.
 *
 * If you find yourself wanting to send more data across this boundary,
 * you are making an architectural mistake. Stop and reconsider.
 */
export interface AnnotationEvent {
  sessionId: string;
  timestamp: string;
  annotationDensity: number;
  patternCounts: Record<string, number>;
  highConfidenceCount: number;
  batchTextLength: number;
}

/**
 * Emits AnnotationEvents to subscribers (the Reflection Pool).
 * Implementation: local EventEmitter or WebSocket on a dedicated port.
 * The subscriber never requests data — it only receives what is pushed.
 */
export interface AnnotationBridge {
  emit(event: AnnotationEvent): void;
  subscribe(handler: (event: AnnotationEvent) => void): () => void;
}
