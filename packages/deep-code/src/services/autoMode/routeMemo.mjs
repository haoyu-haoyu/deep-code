// Shared "latest human user message" extraction + a per-task auto-route memo.
//
// The auto-router's decision is "valid for the whole task" (its own system prompt
// says so), but resolveAutoRoute re-ran routeTurn on EVERY tool-loop continuation
// turn — paying an ~80-token classifier round-trip per turn AND risking a
// flash<->pro flip that rewrites the request's `model` field. `model` scopes the
// DeepSeek positional prefix cache, so a mid-task flip COLD-RESETS the ~93% cache
// moat. Memoizing the decision per task (keyed on the latest human user message —
// stable across continuations, changes only on a new prompt) fires routeTurn once
// per user turn; continuations reuse the decision.
//
// extractLatestUserMessage/contentToText live here (not router.ts) so the memo
// keys on EXACTLY what routeTurn classifies on — one extraction, no drift.

/** Reduce a message's content (string | array of text/blocks) to plain text. */
export function contentToText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const text = part.text
          if (typeof text === 'string') return text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * The most recent user message that carries actual text — scanning from the end
 * and SKIPPING tool-result-only user messages (which reduce to empty text). This
 * is the task boundary: it is unchanged across a tool-loop (the human prompt
 * doesn't move) and changes when the user sends a new prompt.
 * @param {readonly unknown[]} messages
 * @returns {string}
 */
export function extractLatestUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i]
    if (!candidate || typeof candidate !== 'object') continue
    if (candidate.role !== 'user') continue
    const text = contentToText(candidate.content)
    if (text.trim()) return text
  }
  return ''
}

// Per-task route memo. Small LRU so a long session touching several distinct tasks
// stays bounded (re-asking an earlier task also reuses its decision — the router
// would classify it the same way). Keyed by the latest-user-message text. The
// stored value is the classifier DECISION (the expensive ~80-token round-trip);
// the caller still maps decision -> concrete model every turn, so a mid-session
// config change is reflected without re-classifying.
const MAX_MEMOIZED_TASKS = 16
const memo = new Map()

/** The memoized routing decision for a task key, or null on a miss. */
export function getMemoizedRoute(taskKey) {
  return memo.has(taskKey) ? memo.get(taskKey) : null
}

/** Memoize a routing decision for a task key (LRU: re-insert most-recent, evict oldest). */
export function setMemoizedRoute(taskKey, route) {
  memo.delete(taskKey)
  memo.set(taskKey, route)
  while (memo.size > MAX_MEMOIZED_TASKS) {
    memo.delete(memo.keys().next().value)
  }
}

/** Drop all memoized decisions (tests / session reset). */
export function clearRouteMemo() {
  memo.clear()
}
