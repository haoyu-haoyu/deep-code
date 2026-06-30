// When the DeepSeek-native /compact request overflows the small model, drop the
// OLDER half of the conversation and retry. The most recent tail is what matters
// most for a continuation summary, so keep it; halving guarantees progress (drops
// >= 1 for length >= 2) and converges to a single message in O(log n) retries.
//
// Returns null when nothing more can be dropped (<= 1 message) so the caller stops
// retrying and surfaces the overflow instead of looping forever (a single message
// larger than the small model's window cannot be summarized by head-truncation).
//
// @param {ReadonlyArray<unknown>} messages
// @returns {Array<unknown> | null}
export function truncateMessagesHeadForCompact(messages) {
  if (!Array.isArray(messages) || messages.length <= 1) return null
  return messages.slice(Math.ceil(messages.length / 2))
}
