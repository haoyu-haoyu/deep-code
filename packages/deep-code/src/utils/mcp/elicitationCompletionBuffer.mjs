/**
 * A small, bounded buffer of URL-elicitation completion notifications that
 * arrived BEFORE their queue entry existed.
 *
 * Both elicitation paths register the dialog's queue entry only AFTER an
 * `await runElicitationHooks(...)`:
 *   - the request handler (registerElicitationHandler) adds the entry after its
 *     hooks await, and
 *   - the error-based retry path (callMCPToolWithUrlElicitationRetry) adds it
 *     after its hooks await.
 * A fast server can deliver the ElicitationComplete notification during that
 * await. The completion handler matches the notification to a queued entry by
 * (serverName, elicitationId); with no entry yet it previously DROPPED the
 * notification, so the entry was later born with `completed` unset and the
 * dialog never auto-dismissed (it only auto-dismisses on `completed === true`),
 * forcing the user to retry manually.
 *
 * The handler now `markCompleted`s an unmatched completion here; each queue-add
 * `consumeCompleted`s and, if a completion was buffered, is born `completed`.
 *
 * Bounded (insertion-ordered Map, oldest evicted past `max`) so a completion
 * that never gets a queue entry — e.g. an elicitation resolved by a hook or
 * abandoned — cannot grow the buffer without limit.
 */

const DEFAULT_MAX = 128

function keyOf(serverName, elicitationId) {
  // JSON-encode the pair: injective over arbitrary strings, so two distinct
  // (serverName, elicitationId) pairs can never collide on one key.
  return JSON.stringify([serverName, elicitationId])
}

/**
 * @param {number} [max] capacity before the oldest buffered completion is evicted
 */
export function createElicitationCompletionBuffer(max = DEFAULT_MAX) {
  /** @type {Map<string, true>} insertion-ordered: first key is the oldest */
  const seen = new Map()

  return {
    /** Record a completion that had no matching queue entry yet. */
    markCompleted(serverName, elicitationId) {
      if (elicitationId == null) return
      const k = keyOf(serverName, elicitationId)
      // Re-mark refreshes recency so a repeat isn't evicted as "oldest".
      seen.delete(k)
      seen.set(k, true)
      while (seen.size > max) {
        const oldest = seen.keys().next().value
        seen.delete(oldest)
      }
    },

    /**
     * Consume (and clear) a buffered completion for this elicitation.
     * @returns {boolean} true if a completion had been buffered.
     */
    consumeCompleted(serverName, elicitationId) {
      if (elicitationId == null) return false
      return seen.delete(keyOf(serverName, elicitationId))
    },

    /** Buffered-but-unconsumed count (tests/observability). */
    size() {
      return seen.size
    },
  }
}

/** Process-wide buffer shared by the notification handler and the queue adders. */
export const elicitationCompletionBuffer = createElicitationCompletionBuffer()
