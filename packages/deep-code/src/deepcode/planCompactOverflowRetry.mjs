import { detectDeepSeekContextOverflow } from '../services/runtime/deepSeekContextOverflow.mjs'
import { truncateMessagesHeadForCompact } from './truncateMessagesHeadForCompact.mjs'

// Cap the head-truncation retries. Halving the conversation each time converges in
// O(log n) steps, so 10 covers a ~1000-message tail before giving up.
export const MAX_COMPACT_OVERFLOW_RETRIES = 10

// Decide whether a FAILED native /compact attempt should retry with a head-
// truncated message list.
//
// The native compact path (compactDeepCodeConversation) serializes the whole
// conversation tail into ONE small-model request with no per-message bound, so a
// large conversation overflows the small model's context window -> an HTTP 400.
// Unlike the upstream path (services/compact/compact.ts, which detects the overflow
// and runs a truncate-head PTL retry), the native path had NO recovery: the error
// propagated, the caller left history unchanged, and every re-/compact rebuilt the
// identical oversized request -> a permanent compaction wedge exactly when the user
// most needs to compact. This restores the same truncate-head recovery for the
// native path.
//
// Returns the truncated messages to retry with, or null to give up (re-throw the
// original error) when: retries are exhausted, the error is NOT a context overflow
// (a real failure / abort must propagate, not be masked by truncation), or nothing
// more can be dropped (a single message still overflows).
//
// @param {{ message?: string } | null | undefined} error  the thrown error
// @param {ReadonlyArray<unknown>} messages  the tail that just failed
// @param {number} attempt  0-based index of the attempt that just failed
// @param {number} [maxRetries]
// @returns {Array<unknown> | null}
export function planCompactOverflowRetry(
  error,
  messages,
  attempt,
  maxRetries = MAX_COMPACT_OVERFLOW_RETRIES,
) {
  if (attempt >= maxRetries) return null
  if (!detectDeepSeekContextOverflow(error?.message).isOverflow) return null
  return truncateMessagesHeadForCompact(messages)
}
