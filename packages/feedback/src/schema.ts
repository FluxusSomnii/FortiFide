/**
 * AccuracyFeedback is the ONLY feedback schema in Fides.
 *
 * ARCHITECTURAL CONSTRAINTS (these are not suggestions):
 * - There is NO pattern category field.
 * - There is NO severity field.
 * - There is NO "suppress this pattern type" field.
 * - There is NO mechanism for a user to reduce visibility of an entire pattern category.
 * - The schema has exactly three fields. Do not add fields.
 *
 * WHY: If the schema has a pattern category field, someone will use it
 * to build suppression. Remove the possibility at the schema level.
 * Pattern suppression is self-blinding, not feedback.
 *
 * If a user wants to filter what they SEE in the review panel, that is
 * a DisplayPreference (UI layer). The detection layer and display layer
 * are strictly separated. Fides always detects everything its library covers.
 * The full annotated record is always kept regardless of display preferences.
 */
export interface AccuracyFeedback {
  detectionId: string;
  timestamp: string;
  wasIncorrect: boolean;
}
