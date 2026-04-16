// Bridge: emits AnnotationEvent over a local socket to the Reflection Pool.
//
// The bridge is a ONE-WAY signal quality pipe. It carries AnnotationEvent ONLY:
// - annotationDensity, patternCounts, highConfidenceCount, batchTextLength
//
// It NEVER carries source text, session data, DetectionInstance objects,
// or user feedback. This is a privacy and architectural boundary.
//
// TODO: Implement local WebSocket server for AnnotationEvent emission
// to the Reflection Pool. The subscriber never requests data — it only
// receives what is pushed.
