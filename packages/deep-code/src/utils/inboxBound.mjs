/**
 * Pure, node-testable helpers that bound a teammate mailbox file so it cannot
 * grow without limit (a prompt-injected or dead/slow teammate could otherwise
 * flood a peer/leader inbox or pile up a giant single message → model-context
 * blow-out + O(N^2) re-read/rewrite IO, since every write rewrites the whole
 * array under the lock and read tombstones were never pruned).
 *
 * Both functions are value-in/value-out so the `.ts` mailbox layer (bun-tainted,
 * not node-loadable) stays a thin wire. The caller injects the limits and the
 * `isProtected` classifier. Structured control messages (shutdown / permission /
 * plan-approval) are EVICTION-LAST and never truncated, so a flood preferentially
 * sheds plain peer chatter and the control channel stays live in normal use. They
 * are NOT immune, though: `isProtected` keys off the raw body, which a peer can
 * FORGE (a plain string that JSON-parses to a control `type`). If protection were
 * absolute, forged-protected messages would evade every cap and reopen the
 * unbounded-growth DoS — so once only protected + the newest message remain over a
 * cap, the OLDEST protected message is evicted as a last resort. The just-appended
 * NEWEST message is never DROPPED (its body may still be truncated by step 1 if it
 * is an oversized non-protected message, but the message itself is retained).
 */

import { truncateAtCodeUnitBoundary } from './truncateAtCodeUnitBoundary.mjs'

const DEFAULT_TRUNCATION_MARKER =
  '\n[... message truncated: exceeded the per-message size limit ...]'

function textLen(m) {
  return m && typeof m.text === 'string' ? m.text.length : 0
}

/**
 * Bound the post-append inbox array. Applied inside writeToMailbox under the
 * existing lock, atomic with the append (the newest message is the last element
 * and is never dropped; an oversized non-protected newest body may still be
 * truncated by step 1).
 *
 * Order: (1) truncate over-long NON-protected message text with a visible
 * marker; (2) drop read:true tombstones (already consumed → redelivery-safe,
 * removal == not-re-read); (3) while over the count OR total-char cap, evict the
 * OLDEST droppable message (never the newest), PREFERRING a non-protected one and
 * falling back to the oldest protected one only when no non-protected remains —
 * so the cap is ALWAYS enforced (forged-"protected" floods cannot evade it) while
 * legitimate control messages are shed last. Each eviction is recorded in
 * `dropped` (the caller logs — no silent loss).
 *
 * @param {Array<{from?:string,text?:string,read?:boolean,timestamp?:string}>} messages
 * @param {object} opts
 * @param {(m:object)=>boolean} opts.isProtected - true for structured control messages (evict-last)
 * @param {number} opts.maxMessages - hard cap on retained message count
 * @param {number} opts.maxTotalChars - hard cap on summed text length
 * @param {number} opts.maxMessageChars - per-message text cap (non-protected only)
 * @param {string} [opts.truncationMarker]
 * @returns {{messages:Array,dropped:Array,truncatedCount:number,prunedRead:number}}
 */
export function boundInboxMessages(
  messages,
  { isProtected, maxMessages, maxTotalChars, maxMessageChars, truncationMarker },
) {
  if (!Array.isArray(messages)) {
    return { messages: [], dropped: [], truncatedCount: 0, prunedRead: 0 }
  }
  const protectedFn = typeof isProtected === 'function' ? isProtected : () => false
  const marker =
    typeof truncationMarker === 'string'
      ? truncationMarker
      : DEFAULT_TRUNCATION_MARKER

  // (1) truncate over-long non-protected text
  let truncatedCount = 0
  let arr = messages.map(m => {
    if (
      m &&
      !protectedFn(m) &&
      typeof m.text === 'string' &&
      Number.isFinite(maxMessageChars) &&
      m.text.length > maxMessageChars
    ) {
      truncatedCount++
      // Truncate on a code-unit boundary so the cut can't split a surrogate pair
      // into a lone surrogate — this text enters a peer/leader inbox and the model
      // context, where an unpaired surrogate can't be UTF-8/JSON encoded.
      return {
        ...m,
        text: truncateAtCodeUnitBoundary(m.text, maxMessageChars) + marker,
      }
    }
    return m
  })

  // (2) drop read tombstones
  const beforePrune = arr.length
  arr = arr.filter(m => m && !m.read)
  const prunedRead = beforePrune - arr.length

  // (3) count + char caps via drop-oldest, never the newest. Prefer the oldest
  // NON-protected message; fall back to the oldest protected one only when no
  // non-protected remains. This keeps the cap ALWAYS enforced — a forged-
  // "protected" flood (a peer's plain string that parses as a control type)
  // cannot evade it — while real control messages are shed last.
  const newest = arr.length ? arr[arr.length - 1] : undefined
  const dropped = []
  const overCap = () =>
    (Number.isFinite(maxMessages) && arr.length > maxMessages) ||
    (Number.isFinite(maxTotalChars) &&
      arr.reduce((s, m) => s + textLen(m), 0) > maxTotalChars)
  while (arr.length > 1 && overCap()) {
    let idx = arr.findIndex(m => m !== newest && !protectedFn(m))
    if (idx === -1) idx = arr.findIndex(m => m !== newest) // last resort: oldest protected
    if (idx === -1) break // only the newest message remains
    dropped.push(arr[idx])
    arr.splice(idx, 1)
  }

  return { messages: arr, dropped, truncatedCount, prunedRead }
}

/**
 * Resolve which array index to mark read, identity-verified.
 *
 * markMessageAsReadByIndex was called with an index computed from an UNLOCKED
 * readMailbox snapshot; once writeToMailbox can prune/evict (changing positions),
 * a raw index could mark the WRONG message. This re-validates: use the supplied
 * index iff it still points at the EXPECTED unread message; otherwise re-find the
 * first unread message matching the expected identity (from+timestamp+text);
 * otherwise -1 (already consumed/pruned → no-op). This also closes the
 * pre-existing read→mark TOCTOU. Marks EXACTLY ONE message.
 *
 * @param {Array} messages - the under-lock re-read array
 * @param {number} index - the caller's positional hint
 * @param {{from?:string,timestamp?:string,text?:string}} expected - identity of the message the caller consumed
 * @returns {number} index to mark, or -1
 */
export function resolveReadMarkIndex(messages, index, expected) {
  if (!Array.isArray(messages) || !expected) return -1
  const matches = m =>
    !!m &&
    m.read !== true &&
    m.from === expected.from &&
    m.timestamp === expected.timestamp &&
    m.text === expected.text
  if (
    Number.isInteger(index) &&
    index >= 0 &&
    index < messages.length &&
    matches(messages[index])
  ) {
    return index
  }
  return messages.findIndex(matches)
}

/**
 * Stable, collision-free identity key for a mailbox message — the same
 * (from,timestamp,text) triple resolveReadMarkIndex matches on, encoded as JSON
 * so arbitrary text (including separators/NUL) cannot collide two distinct
 * triples.
 *
 * @param {{from?:string,timestamp?:string,text?:string}} m
 * @returns {string}
 */
function messageIdentityKey(m) {
  return JSON.stringify([m && m.from, m && m.timestamp, m && m.text])
}

/**
 * Mark read EXACTLY the messages a poll consumed (its UNLOCKED `unread`
 * snapshot), identified by the same (from,timestamp,text) triple as
 * resolveReadMarkIndex, leaving every other message untouched.
 *
 * The poller reads unread messages WITHOUT the lock, routes that snapshot, then
 * marks read under the lock. The old mark-all path set read:true on EVERY
 * message in the under-lock re-read — including any message a concurrent
 * writeToMailbox appended AFTER the snapshot (a mid-poll arrival). That late
 * message was never in the snapshot, so it was never delivered, yet it was
 * marked read → silent permanent loss, defeating the poller's stated no-loss
 * intent. Marking only the consumed snapshot leaves a mid-poll arrival unread so
 * the next poll delivers it.
 *
 * Uses a per-identity COUNT (multiset), not a Set: if a mid-poll arrival happens
 * to share an identical (from,timestamp,text) triple with a consumed message,
 * only as many copies as were actually consumed are marked, and the extra stays
 * unread. Walks oldest→newest, marking the oldest matching unread copies first.
 * Returns a NEW array; unchanged messages are returned by reference (mirroring
 * markMessagesAsReadByPredicate's .map shape). Non-array `messages` is returned
 * as-is; a missing/empty `consumed` marks nothing.
 *
 * @param {Array<{from?:string,timestamp?:string,text?:string,read?:boolean}>} messages - the under-lock re-read array
 * @param {Array<{from?:string,timestamp?:string,text?:string}>} consumed - the snapshot the poll actually read/routed
 * @returns {Array} a new array with read:true on the consumed-and-still-unread messages
 */
export function applyConsumedReadMarks(messages, consumed) {
  if (!Array.isArray(messages)) return messages
  const remaining = new Map()
  if (Array.isArray(consumed)) {
    for (const c of consumed) {
      if (!c) continue
      const key = messageIdentityKey(c)
      remaining.set(key, (remaining.get(key) ?? 0) + 1)
    }
  }
  return messages.map(m => {
    if (m && m.read !== true) {
      const key = messageIdentityKey(m)
      const left = remaining.get(key) ?? 0
      if (left > 0) {
        remaining.set(key, left - 1)
        return { ...m, read: true }
      }
    }
    return m
  })
}
