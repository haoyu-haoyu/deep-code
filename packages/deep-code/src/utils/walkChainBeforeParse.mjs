// Byte-level pre-filter that excises dead fork branches before parseJSONL.
//
// Every rewind/ctrl-z leaves an orphaned chain branch in the append-only
// JSONL forever. buildConversationChain walks parentUuid from the latest leaf
// and discards everything else, but by then parseJSONL has already paid to
// JSON.parse all of it. Measured on fork-heavy sessions:
//
//   41 MB, 99% dead: parseJSONL 56.0 ms -> 3.9 ms (-93%)
//   151 MB, 92% dead: 47.3 ms -> 9.4 ms (-80%)
//
// Sessions with few dead branches (5-7%) see a small win from the overhead of
// the index pass roughly canceling the parse savings, so this is gated on
// buffer size (same threshold as SKIP_PRECOMPACT_THRESHOLD).
//
// Relies on two invariants verified across 25k+ message lines in local
// sessions (0 violations):
//
//   1. Transcript messages always serialize with parentUuid as the first key.
//      JSON.stringify emits keys in insertion order and recordTranscript's
//      object literal puts parentUuid first. So `{"parentUuid":` is a stable
//      line prefix that distinguishes transcript messages from metadata.
//
//   2. Top-level uuid detection is handled by a suffix check + depth check
//      (see inline comment in the scan loop). toolUseResult/mcpMeta serialize
//      AFTER uuid with arbitrary server-controlled objects, and agent_progress
//      entries serialize a nested Message in data BEFORE uuid — both can
//      produce nested `"uuid":"<36>","timestamp":"` bytes, so suffix alone
//      is insufficient. When multiple suffix matches exist, a brace-depth
//      scan disambiguates.
//
// The append-only write discipline guarantees parents appear at earlier file
// offsets than children, so walking from a leaf back to root always finds them.

/**
 * Disambiguate multiple `"uuid":"<36>","timestamp":"` matches in one line by
 * finding the one at JSON nesting depth 1. String-aware brace counter:
 * `{`/`}` inside string values don't count; `\"` and `\\` inside strings are
 * handled. Candidates is sorted ascending (the scan loop produces them in
 * byte order). Returns the first depth-1 candidate, or the last candidate if
 * none are at depth 1 (shouldn't happen for well-formed JSONL — depth-1 is
 * where the top-level object's fields live).
 *
 * Only called when ≥2 suffix matches exist (agent_progress with a nested
 * Message, or mcpMeta with a coincidentally-suffixed object). Cost is
 * O(max(candidates) - lineStart) — one forward byte pass, stopping at the
 * first depth-1 hit.
 *
 * @param {Buffer} buf
 * @param {number} lineStart
 * @param {number[]} candidates
 * @returns {number}
 */
function pickDepthOneUuidCandidate(buf, lineStart, candidates) {
  const QUOTE = 0x22
  const BACKSLASH = 0x5c
  const OPEN_BRACE = 0x7b
  const CLOSE_BRACE = 0x7d
  let depth = 0
  let inString = false
  let escapeNext = false
  let ci = 0
  for (let i = lineStart; ci < candidates.length; i++) {
    if (i === candidates[ci]) {
      if (depth === 1 && !inString) return candidates[ci]
      ci++
    }
    const b = buf[i]
    if (escapeNext) {
      escapeNext = false
    } else if (inString) {
      if (b === BACKSLASH) escapeNext = true
      else if (b === QUOTE) inString = false
    } else if (b === QUOTE) inString = true
    else if (b === OPEN_BRACE) depth++
    else if (b === CLOSE_BRACE) depth--
  }
  return candidates.at(-1)
}

/**
 * @param {Buffer} buf
 * @returns {Buffer} the pruned buffer (or `buf` itself when pruning is not
 *   worthwhile or no leaf is found).
 */
export function walkChainBeforeParse(buf) {
  const NEWLINE = 0x0a
  const OPEN_BRACE = 0x7b
  const QUOTE = 0x22
  const PARENT_PREFIX = Buffer.from('{"parentUuid":')
  const UUID_KEY = Buffer.from('"uuid":"')
  const SIDECHAIN_TRUE = Buffer.from('"isSidechain":true')
  const UUID_LEN = 36
  const TS_SUFFIX = Buffer.from('","timestamp":"')
  const TS_SUFFIX_LEN = TS_SUFFIX.length
  const PREFIX_LEN = PARENT_PREFIX.length
  const KEY_LEN = UUID_KEY.length

  // Stride-4 flat index of transcript messages:
  // [lineStart, lineEnd, parentStart, tsStart].
  //   parentStart: byte offset of the parent uuid's first char, or -1 for null.
  //   tsStart: byte offset of the top-level timestamp VALUE's first char, or -1
  //     when the uuid had no adjacent `","timestamp":"` suffix (rare progress
  //     variants). Only entries with a usable tsStart can win the max-timestamp
  //     leaf pick — exactly the entries findLatestMessage can Date.parse.
  // Metadata lines (summary, mode, file-history-snapshot, etc.) go in metaRanges
  // unfiltered - they lack the parentUuid prefix and downstream needs all of them.
  const msgIdx = []
  const metaRanges = []
  const uuidToSlot = new Map()

  let pos = 0
  const len = buf.length
  while (pos < len) {
    const nl = buf.indexOf(NEWLINE, pos)
    const lineEnd = nl === -1 ? len : nl + 1
    if (
      lineEnd - pos > PREFIX_LEN &&
      buf[pos] === OPEN_BRACE &&
      buf.compare(PARENT_PREFIX, 0, PREFIX_LEN, pos, pos + PREFIX_LEN) === 0
    ) {
      // `{"parentUuid":null,` or `{"parentUuid":"<36 chars>",`
      const parentStart =
        buf[pos + PREFIX_LEN] === QUOTE ? pos + PREFIX_LEN + 1 : -1
      // The top-level uuid is immediately followed by `","timestamp":"` in
      // user/assistant/attachment entries (the create* helpers put them
      // adjacent; both always defined). But the suffix is NOT unique:
      //   - agent_progress entries carry a nested Message in data.message,
      //     serialized BEFORE top-level uuid — that inner Message has its
      //     own uuid,timestamp adjacent, so its bytes also satisfy the
      //     suffix check.
      //   - mcpMeta/toolUseResult come AFTER top-level uuid and hold
      //     server-controlled Record<string,unknown> — a server returning
      //     {uuid:"<36>",timestamp:"..."} would also match.
      // Collect all suffix matches; a single one is unambiguous (common
      // case), multiple need a brace-depth check to pick the one at
      // JSON nesting depth 1. Entries with NO suffix match (some progress
      // variants put timestamp BEFORE uuid → `"uuid":"<36>"}` at EOL)
      // have only one `"uuid":"` and the first-match fallback is sound.
      let firstAny = -1
      let suffix0 = -1
      let suffixN
      let from = pos
      for (;;) {
        const next = buf.indexOf(UUID_KEY, from)
        if (next < 0 || next >= lineEnd) break
        if (firstAny < 0) firstAny = next
        const after = next + KEY_LEN + UUID_LEN
        if (
          after + TS_SUFFIX_LEN <= lineEnd &&
          buf.compare(
            TS_SUFFIX,
            0,
            TS_SUFFIX_LEN,
            after,
            after + TS_SUFFIX_LEN,
          ) === 0
        ) {
          if (suffix0 < 0) suffix0 = next
          else (suffixN ??= [suffix0]).push(next)
        }
        from = next + KEY_LEN
      }
      const uk = suffixN
        ? pickDepthOneUuidCandidate(buf, pos, suffixN)
        : suffix0 >= 0
          ? suffix0
          : firstAny
      if (uk >= 0) {
        const uuidStart = uk + KEY_LEN
        // UUIDs are pure ASCII so latin1 avoids UTF-8 decode overhead.
        const uuid = buf.toString('latin1', uuidStart, uuidStart + UUID_LEN)
        // The timestamp value is adjacent to the uuid ONLY when uk came from a
        // suffix match (suffix0 / a depth-1 candidate). For the firstAny
        // fallback there is no adjacent `","timestamp":"`, so no tsStart.
        const hasAdjacentTs = suffixN !== undefined || suffix0 >= 0
        const tsStart = hasAdjacentTs
          ? uuidStart + UUID_LEN + TS_SUFFIX_LEN
          : -1
        uuidToSlot.set(uuid, msgIdx.length)
        msgIdx.push(pos, lineEnd, parentStart, tsStart)
      } else {
        metaRanges.push(pos, lineEnd)
      }
    } else {
      metaRanges.push(pos, lineEnd)
    }
    pos = lineEnd
  }

  // Slots referenced as some message's parent — the complement is the set of
  // TERMINALS (no children). Built from every indexed line's parentUuid,
  // including sidechain entries' parents, to match loadTranscriptFile's
  // downstream `parentUuids` set exactly (a main entry a sidechain hangs off of
  // is non-terminal there too).
  const referencedSlots = new Set()
  for (let i = 0; i < msgIdx.length; i += 4) {
    const ps = msgIdx[i + 2]
    if (ps >= 0) {
      const parent = buf.toString('latin1', ps, ps + UUID_LEN)
      const pslot = uuidToSlot.get(parent)
      if (pslot !== undefined) referencedSlots.add(pslot)
    }
  }

  // Anchor on the LATEST (max-timestamp) non-sidechain TERMINAL — the same
  // chronological rule findLatestMessage / selectResumeLeaf apply after parse —
  // not the physically-last line. Under a monotonic wall clock the two agree
  // (the live tip is appended last AND carries the max timestamp), so this is
  // behavior-identical on every well-behaved session. They diverge only when
  // the clock stepped backward (NTP correction, suspend/resume) or branches got
  // interleaved with out-of-order stamps: there the old file-order pick anchored
  // a stale branch, and the post-parse loader — which anchors by max timestamp —
  // would then reconstruct a DIFFERENT chain than the one the prune kept, i.e.
  // silently load the wrong/truncated conversation. Matching the comparison here
  // keeps the prune transparent to the loader.
  //
  // Timestamps are compared as bytes: create*-written stamps are fixed-width
  // `toISOString()` UTC (`...Z`), so lexical order equals chronological order
  // and ties (identical bytes = same instant) keep the first-iterated entry,
  // matching findLatestMessage's strict `>`.
  //
  // selectResumeLeaf (and the other reconstruction sites) anchor in two tiers:
  // the latest non-sidechain user/assistant LEAF, else the latest non-sidechain
  // entry of any kind. We reproduce both byte-level. The leaf tier uses
  // "non-sidechain TERMINAL" (a uuid with no children) as the type-free proxy
  // for "user/assistant leaf": on a real transcript the tip is a user/assistant
  // turn, so the max-timestamp non-sidechain terminal's chain contains exactly
  // the leaf the loader would anchor on. The any tier matches the fallback
  // verbatim. (We can't decode `type` cheaply — the top-level `type` key is not
  // positionally stable and content blocks carry nested `"type":"…"` — so a
  // non-user/assistant physical tip stays an approximation, as it was before.)
  const pickLatest = requireTerminal => {
    let slot = -1
    let bestStart = -1
    let bestEnd = -1
    for (let i = 0; i < msgIdx.length; i += 4) {
      if (requireTerminal && referencedSlots.has(i)) continue // not a terminal
      const tsStart = msgIdx[i + 3]
      if (tsStart < 0) continue // no Date.parse-able timestamp → never the anchor
      const lineStart = msgIdx[i]
      const lineEnd = msgIdx[i + 1]
      const sc = buf.indexOf(SIDECHAIN_TRUE, lineStart)
      if (sc !== -1 && sc < lineEnd) continue // sidechain
      const tsEnd = buf.indexOf(QUOTE, tsStart)
      if (tsEnd < 0 || tsEnd >= lineEnd) continue // malformed timestamp field
      // buf.compare(target, tStart, tEnd, sStart, sEnd) returns the sign of
      // (source[sStart,sEnd) - target[tStart,tEnd)); >0 here means the current
      // entry's stamp sorts AFTER the best so far (later instant). Strict `>`
      // leaves an equal stamp on the first-iterated entry, matching
      // findLatestMessage.
      if (slot < 0 || buf.compare(buf, bestStart, bestEnd, tsStart, tsEnd) > 0) {
        slot = i
        bestStart = tsStart
        bestEnd = tsEnd
      }
    }
    return slot
  }

  // Tier 1: latest non-sidechain terminal (≈ the user/assistant leaf anchor).
  // Tier 2: latest non-sidechain entry of any kind (the loader's own fallback,
  // reached when every terminal is a sidechain — e.g. a subagent turn is the
  // physical tip).
  let leafSlot = pickLatest(true)
  if (leafSlot < 0) leafSlot = pickLatest(false)
  if (leafSlot < 0) {
    // Tier 3, degenerate: no entry carries a usable timestamp. The loader's
    // findLatestMessage would Date.parse nothing here; preserve the historical
    // pick — the physically-last non-sidechain entry — so a malformed transcript
    // still resolves the same chain it did before.
    for (let i = msgIdx.length - 4; i >= 0; i -= 4) {
      const sc = buf.indexOf(SIDECHAIN_TRUE, msgIdx[i])
      if (sc === -1 || sc >= msgIdx[i + 1]) {
        leafSlot = i
        break
      }
    }
  }
  if (leafSlot < 0) return buf

  // Walk parentUuid to root. Collect kept-message line starts and sum their
  // byte lengths so we can decide whether the concat is worth it. A dangling
  // parent (uuid not in file) is the normal termination for forked sessions
  // and post-boundary chains -- same semantics as buildConversationChain.
  // Correctness against index poisoning rests on the timestamp suffix check
  // above: a nested `"uuid":"` match without the suffix never becomes uk.
  const seen = new Set()
  const chain = new Set()
  let chainBytes = 0
  let slot = leafSlot
  while (slot !== undefined) {
    if (seen.has(slot)) break
    seen.add(slot)
    chain.add(msgIdx[slot])
    chainBytes += msgIdx[slot + 1] - msgIdx[slot]
    const parentStart = msgIdx[slot + 2]
    if (parentStart < 0) break
    const parent = buf.toString('latin1', parentStart, parentStart + UUID_LEN)
    slot = uuidToSlot.get(parent)
  }

  // parseJSONL cost scales with bytes, not entry count. A session can have
  // thousands of dead entries by count but only single-digit-% of bytes if
  // the dead branches are short turns and the live chain holds the fat
  // assistant responses (measured: 107 MB session, 69% dead entries, 30%
  // dead bytes - index+concat overhead exceeded parse savings). Gate on
  // bytes: only stitch if we would drop at least half the buffer. Metadata
  // is tiny so len - chainBytes approximates dead bytes closely enough.
  // Near break-even the concat memcpy (copying chainBytes into a fresh
  // allocation) dominates, so a conservative 50% gate stays safely on the
  // winning side.
  if (len - chainBytes < len >> 1) return buf

  // Merge chain entries with metadata in original file order. Both msgIdx and
  // metaRanges are already sorted by offset; interleave them into subarray
  // views and concat once.
  const parts = []
  let m = 0
  for (let i = 0; i < msgIdx.length; i += 4) {
    const start = msgIdx[i]
    while (m < metaRanges.length && metaRanges[m] < start) {
      parts.push(buf.subarray(metaRanges[m], metaRanges[m + 1]))
      m += 2
    }
    if (chain.has(start)) {
      parts.push(buf.subarray(start, msgIdx[i + 1]))
    }
  }
  while (m < metaRanges.length) {
    parts.push(buf.subarray(metaRanges[m], metaRanges[m + 1]))
    m += 2
  }
  return Buffer.concat(parts)
}
