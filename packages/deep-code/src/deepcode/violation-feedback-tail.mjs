// Pure, node-testable: append the fortress violation-feedback AGGREGATE to the message
// TAIL as a transient reminder, gated on a violation-COUNT delta. Wiring the otherwise-
// dead buildViolationFeedback() so the model sees the session-level "you've been blocked
// N times" nudge and stops retrying blocked ops (the per-block deny messages already carry
// the per-op detail inline — this is the once-per-new-violation escalation, not a repeat).
//
// CACHE-MOAT (the #1 invariant, see deepcode/stable-prefix.mjs): the reminder is APPENDED
// as a brand-new final message — earlier messages are never mutated — so every turn's
// request stays a byte-identical PREFIX of the next (transient state rides the tail). And
// it is gated on getViolationCount() !== lastSurfacedCount, so:
//   • no violations (the default) → count 0 === lastSurfaced 0 → the SAME array is returned
//     (object-identity) → request byte-identical to the no-fortress baseline (default-inert);
//   • a quiet turn (no NEW violation) → count unchanged → unchanged array → stable tail;
//   • a turn after ≥1 new violation → surfaced exactly once, then suppressed until the next
//     new violation (the dedup: the same summary is never re-injected turn-over-turn).
//
// Pure + deterministic: the manager (getViolationCount/buildViolationFeedback) and the
// message factory are INJECTED, so a unit test passes fakes (no fortress/loop boot). Never
// throws — any manager error returns the messages unchanged (fail-safe: feedback is a
// best-effort nudge, never break the turn).

/**
 * @param {Array} messages the finalized per-turn messages (already prepend-context'd).
 * @param {{getViolationCount: () => number, buildViolationFeedback: () => (string|null)}} manager
 * @param {number} lastSurfacedCount the violation count at the last surface (cross-turn dedup state).
 * @param {(text: string) => any} makeReminderMessage builds the trailing transient message
 *   from the feedback text (query.ts injects createUserMessage(wrapInSystemReminder(text), isMeta)).
 * @returns {{messages: Array, surfacedCount: number}} the (possibly) extended messages + the
 *   new surfaced count to carry into the next turn. `messages` is the SAME array reference
 *   when nothing is appended (preserves byte-identity).
 */
export function appendViolationFeedbackTail(messages, manager, lastSurfacedCount, makeReminderMessage) {
  if (!Array.isArray(messages)) return { messages, surfacedCount: lastSurfacedCount }
  const last = Number.isInteger(lastSurfacedCount) ? lastSurfacedCount : 0

  let count
  try {
    count = manager.getViolationCount()
  } catch {
    return { messages, surfacedCount: last } // fail-safe: never break the turn
  }
  if (!Number.isInteger(count) || count < 0) return { messages, surfacedCount: last }
  // No NEW violation since we last surfaced → leave the tail byte-stable (no re-injection).
  if (count === last) return { messages, surfacedCount: last }

  let feedback
  try {
    feedback = manager.buildViolationFeedback()
  } catch {
    return { messages, surfacedCount: last } // fail-safe (don't advance the count on error)
  }
  // count changed but no renderable feedback (e.g. count dropped on a bounded-mirror evict)
  // → sync the count so we don't re-check the same delta every turn, but append nothing.
  if (typeof feedback !== 'string' || feedback === '') return { messages, surfacedCount: count }

  let reminder
  try {
    reminder = makeReminderMessage(feedback)
  } catch {
    return { messages, surfacedCount: last } // fail-safe: bad factory → unchanged
  }
  if (reminder == null) return { messages, surfacedCount: count }
  return { messages: [...messages, reminder], surfacedCount: count }
}
