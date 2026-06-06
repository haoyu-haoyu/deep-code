// Pure, node-testable violation-log + dry-run core for the Sandbox Fortress (F3
// PR-2). Backs FortressSandboxManager's getViolationDb / buildViolationFeedback /
// enableDryRunMode / isDryRunMode (manager.ts) as a standalone .mjs — nothing in
// src/ imports it yet (a later wiring PR does), so dist is byte-identical and the
// DeepSeek prefix-cache moat is untouched.
//
// FAIL-SAFE like the rest of the fortress: never throws on caller input. An audit
// log must be LENIENT on what it keeps (dropping a malformed record could HIDE a
// real violation) but STRICT on its own invariants (bounded memory, deterministic
// order, no caller-mutation of stored records). It never calls Date.now() — record
// timestamps/ids come from the caller, so the log is deterministic + testable.

// ── (1) in-memory violation DB (an IFortressViolationDb, types.ts) ───────────

const DEFAULT_MAX_SIZE = 100

// A recursive, never-throw deep clone — used as the fallback when structuredClone
// is absent or throws (a record carrying a non-cloneable value: function, Symbol,
// Promise, …). It copies arrays + plain objects to ANY depth (so no nested child
// is shared by reference), preserves Date, breaks cycles, DROPS functions/symbols
// (not audit data), and skips a throwing getter. Without this, the fallback would
// share `event`'s deep children → audit tampering could reopen.
function safeDeepClone(value, seen) {
  const t = typeof value
  if (t === 'function' || t === 'symbol') return undefined // not audit data → drop (BEFORE the primitive path, since a symbol is neither object nor function)
  if (value === null || t !== 'object') return value // primitive (string/number/boolean/bigint/undefined)
  if (value instanceof Date) return new Date(value.getTime())
  // `seen` tracks only the CURRENT recursion PATH (ancestors), not all visited
  // nodes, so a true cycle (a back-edge to an ancestor) is dropped while a REPEATED
  // non-cyclic reference (a diamond / shared object) is still cloned — not lost.
  if (seen.has(value)) return undefined // back-edge → break the cycle
  seen.add(value)
  let out
  if (Array.isArray(value)) {
    out = value.map(v => safeDeepClone(v, seen))
  } else {
    out = {}
    for (const k of Object.keys(value)) {
      try {
        out[k] = safeDeepClone(value[k], seen)
      } catch {
        // a throwing getter on this key → skip it (never let it escape)
      }
    }
  }
  seen.delete(value) // unwind: no longer an ancestor → a sibling/later path can clone it again
  return out
}

// A DEEP, never-throw clone so a stored audit entry is fully isolated from the
// caller's object graph at EVERY depth — a shallow/one-level copy would share a
// nested `event` child by reference, letting a caller rewrite a stored violation
// after recording it (masking a real block: audit tampering). structuredClone is
// the fast path (deep, preserves Date/Map/Set); on a non-cloneable value it throws
// → safeDeepClone (recursive, drops the non-cloneable bits) → never throws.
function safeCloneRecord(record) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(record)
    } catch {
      // fall through to the recursive deep clone
    }
  }
  try {
    return safeDeepClone(record, new WeakSet())
  } catch {
    return record // last-last resort (should be unreachable) — never throw
  }
}

/**
 * An in-memory, bounded (ring-buffer) IFortressViolationDb. Async to match the
 * interface (a later PR may swap in a persistent store), but synchronous under the
 * hood. Stores a DEEP COPY of each record AND returns deep copies on read, so
 * neither a post-record caller mutation nor a mutation of a returned element can
 * tamper with a stored audit entry (top-level OR nested `event`).
 * @param {{maxSize?: number}} [options]  ring-buffer cap (default 100); the OLDEST
 *   are dropped past the cap. A non-positive/invalid maxSize falls back to 100.
 * @returns {{recordViolation: Function, listViolations: Function, clearViolations: Function, close: Function}}
 */
export function createInMemoryViolationDb(options = {}) {
  const rawMax = options?.maxSize
  const maxSize = Number.isInteger(rawMax) && rawMax > 0 ? rawMax : DEFAULT_MAX_SIZE
  let violations = []
  let closed = false

  return {
    /** @param {object} record  a FortressViolationRecord. Non-objects are ignored. */
    recordViolation(record) {
      // LENIENT: keep any plausible (non-null object) record — never throw, never
      // drop a real violation for a missing optional field. After close() the DB
      // is released, so recording is a no-op.
      if (!closed && record != null && typeof record === 'object') {
        violations.push(safeCloneRecord(record)) // deep copy: caller can't mutate the stored entry
        if (violations.length > maxSize) violations.shift() // drop the OLDEST (in place, no whole-array copy)
      }
      return Promise.resolve()
    },
    /** @param {number} [limit]  return at most the last `limit` (insertion order). */
    listViolations(limit) {
      if (closed) return Promise.resolve([])
      let slice
      if (limit === undefined) slice = violations
      else if (!Number.isInteger(limit) || limit < 0) return Promise.resolve([]) // invalid → none
      else slice = limit === 0 ? [] : violations.slice(-limit)
      // deep-clone ONLY what we return (not the whole store) — oldest→newest.
      return Promise.resolve(slice.map(safeCloneRecord))
    },
    clearViolations() {
      violations = []
      return Promise.resolve()
    },
    /** Release the DB. Idempotent; subsequent record→no-op, list→[]. */
    close() {
      closed = true
      violations = []
      return Promise.resolve()
    },
  }
}

// ── (2) dry-run mode (backs enableDryRunMode / isDryRunMode) ─────────────────

/**
 * A tiny dry-run mode flag. Dry-run records what the sandbox WOULD block without
 * enforcing it — the LESS-restrictive mode — so the setter coerces fail-safe: only
 * an explicit `true` enables it; any other value (garbage, undefined) leaves
 * enforcement ON.
 * @param {boolean} [initialEnabled]
 */
export function createDryRunController(initialEnabled = false) {
  let enabled = initialEnabled === true
  return {
    enable(value) {
      enabled = value === true
    },
    isEnabled() {
      return enabled
    },
  }
}

// ── (3) violation feedback (backs buildViolationFeedback) ────────────────────

// Sanitize a field for the model-facing feedback: strip ALL control bytes + the
// Unicode line separators (so a crafted violation can NOT forge an extra bullet /
// fake header via a newline AND no raw control byte reaches the output), and cap
// length (so a huge field can't blow up the feedback). Every field goes through this.
function oneLine(value, maxLen = 200) {
  let s
  try {
    s = String(value)
  } catch {
    return 'unknown'
  }
  // C0 controls (incl. \n \r \t NUL BEL ESC), DEL + C1 controls, and U+2028/U+2029;
  // runs collapse to a single space.
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s
}

// Best-effort one-line summary of a SandboxViolationEvent. The runtime event
// carries a human-readable `line`; fall back to `message`, then a compact JSON.
// The WHOLE body is wrapped so a throwing getter on line/message can't escape
// (the module's never-throw contract); newline sanitization is applied by the
// caller via oneLine().
function summarizeEvent(event) {
  try {
    if (event == null || typeof event !== 'object') return String(event ?? 'unknown violation')
    if (typeof event.line === 'string' && event.line.trim() !== '') return event.line.trim()
    if (typeof event.message === 'string' && event.message.trim() !== '') return event.message.trim()
    return JSON.stringify(event)
  } catch {
    return 'unknown violation'
  }
}

/**
 * Build a concise, model-facing feedback string from recent violation records, or
 * null when there are none. DYNAMIC by nature (violations change every turn) — this
 * is NOT for the cached prompt prefix; it is per-turn feedback. Deterministic: no
 * clock, output depends only on the records + options.
 * @param {Array<object>} records  FortressViolationRecord[] (e.g. from listViolations)
 * @param {{limit?: number, dryRunActive?: boolean, total?: number}} [options]  cap the
 *   shown lines (default 10); dryRunActive notes the session is in dry-run; `total` is the
 *   TRUE monotonic session count when `records` is a bounded mirror (so the header reports
 *   the real total, not the capped mirror length — see managerState.getViolationCount).
 * @returns {string|null}
 */
export function buildViolationFeedback(records, options = {}) {
  const list = Array.isArray(records) ? records.filter(r => r != null && typeof r === 'object') : []
  if (list.length === 0) return null

  const rawLimit = options?.limit
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10
  const shown = list.slice(-limit) // most-recent `limit`, oldest→newest

  // `total` lets a bounded-mirror caller report the TRUE session count even after older
  // records were evicted. Only honored when it's a sane integer ≥ what we actually hold
  // (a smaller/garbage total can't shrink the count below the records in hand).
  const rawTotal = options?.total
  const total = Number.isInteger(rawTotal) && rawTotal >= list.length ? rawTotal : list.length
  const hidden = total - shown.length // evicted-from-mirror + beyond-limit, both unshown

  const plural = total === 1 ? 'violation' : 'violations'
  const headerParts = [`Sandbox policy: ${total} ${plural} recorded this session`]
  if (options?.dryRunActive === true) headerParts.push('(dry-run: logged, not enforced)')
  if (hidden > 0) headerParts.push(`(showing last ${shown.length} of ${total})`)

  const lines = shown.map(r => {
    // Each record's line is wrapped so a throwing getter on any field can't escape
    // the never-throw contract; EVERY field goes through oneLine() so a newline in
    // toolName/command/event can't forge a fake bullet or header (line injection).
    try {
      const tags = []
      if (r.dryRun === true) tags.push('dry-run')
      if (typeof r.toolName === 'string' && r.toolName !== '') tags.push(oneLine(r.toolName, 60))
      const prefix = tags.length > 0 ? `[${tags.join(' ')}] ` : ''
      const command = typeof r.command === 'string' && r.command !== '' ? `${oneLine(r.command, 120)}: ` : ''
      return `- ${prefix}${command}${oneLine(summarizeEvent(r.event))}`
    } catch {
      return '- (unparseable violation)'
    }
  })

  return [headerParts.join(' '), ...lines].join('\n')
}
