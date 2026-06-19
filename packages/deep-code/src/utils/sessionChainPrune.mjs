// Byte-level transcript pruner for the --resume / --continue fast path: from a raw
// .jsonl buffer, keep only the bytes of the live conversation chain (leaf ->
// parentUuid -> root) plus metadata, so parseJSONL processes far fewer bytes on a
// large fork-heavy session. Pure (Buffer in, Buffer out) and node-testable, so the
// byte-walk — previously buried in sessionStorage.ts and untestable — can be fuzzed.
//
// PARALLEL-TOOL SAFETY (the correctness contract). A turn with N parallel tool calls
// is persisted as N sibling assistant messages (same message.id) plus N tool_result
// messages whose on-disk parentUuid points at their OWN source assistant. The
// single-parent walk from the leaf follows ONE chain and, depending on tool
// completion order, leaves SOME of those tool_results (and sometimes their sibling
// assistants) OFF the chain. The downstream parser (recoverOrphanedParallelTool-
// Results) splices those off-chain pieces back by message.id sibling group — but
// only if their bytes survived. A byte prune cannot faithfully reproduce that
// message.id sibling-group recovery (it has no parsed message.id, and keeping the
// off-chain pieces can itself change leaf/terminal topology — a prior survey, #486,
// documented that every such heuristic trades one rare divergence for another).
//
// So the contract is simple and provably correct: the pruner is only allowed to
// drop bytes when EVERY tool_result already lies on the single-parent chain (a
// purely linear/sequential tool session — nothing for the parser to recover). The
// instant ANY tool_result is off the chain, the pruner BAILS and returns the full
// buffer, which parseJSONL always handles correctly. This keeps the optimization
// for clean linear sessions while never losing a parallel tool_result or anchoring a
// false resume leaf — at worst it forgoes the speedup (full parse = the behavior
// before this optimization existed), never correctness.

/**
 * @param {Buffer} buf
 * @returns {Buffer} buf unchanged, or a smaller buffer containing only the kept lines
 */
export function walkChainBeforeParse(buf) {
  const NEWLINE = 0x0a
  const OPEN_BRACE = 0x7b
  const QUOTE = 0x22
  const PARENT_PREFIX = Buffer.from('{"parentUuid":')
  const UUID_KEY = Buffer.from('"uuid":"')
  const SIDECHAIN_TRUE = Buffer.from('"isSidechain":true')
  // A tool_result message line carries this marker (a user message whose content
  // holds a tool_result block). JSON.stringify emits it with no key whitespace,
  // so the exact substring is always present; we scan the whole line for it.
  const TOOL_RESULT_MARKER = Buffer.from('"type":"tool_result"')
  const UUID_LEN = 36
  const TS_SUFFIX = Buffer.from('","timestamp":"')
  const TS_SUFFIX_LEN = TS_SUFFIX.length
  const PREFIX_LEN = PARENT_PREFIX.length
  const KEY_LEN = UUID_KEY.length

  // Stride-3 flat index of transcript messages: [lineStart, lineEnd, parentStart].
  // parentStart is the byte offset of the parent uuid's first char, or -1 for null.
  // Metadata lines (summary, mode, file-history-snapshot, etc.) go in metaRanges
  // unfiltered - they lack the parentUuid prefix and downstream needs all of them.
  const msgIdx = []
  const metaRanges = []
  const uuidToSlot = new Map()
  // Parallel to msgIdx entries, keyed by the entry's base index (msgIdx.length at
  // push time): whether the line is a tool_result.
  const entryIsToolResult = new Map()

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
      // user/assistant/attachment entries. The suffix is NOT unique (nested
      // Message in agent_progress, server-controlled mcpMeta), so collect all
      // suffix matches and brace-depth-disambiguate when there are several.
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
          buf.compare(TS_SUFFIX, 0, TS_SUFFIX_LEN, after, after + TS_SUFFIX_LEN) === 0
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
        const base = msgIdx.length
        uuidToSlot.set(uuid, base)
        // Bounded to the line (subarray view): the marker is near the front of a
        // tool_result line, and absent lines stop at lineEnd.
        entryIsToolResult.set(
          base,
          buf.subarray(pos, lineEnd).indexOf(TOOL_RESULT_MARKER) >= 0,
        )
        msgIdx.push(pos, lineEnd, parentStart)
      } else {
        metaRanges.push(pos, lineEnd)
      }
    } else {
      metaRanges.push(pos, lineEnd)
    }
    pos = lineEnd
  }

  // Leaf = last non-sidechain entry.
  let leafSlot = -1
  for (let i = msgIdx.length - 3; i >= 0; i -= 3) {
    const sc = buf.indexOf(SIDECHAIN_TRUE, msgIdx[i])
    if (sc === -1 || sc >= msgIdx[i + 1]) {
      leafSlot = i
      break
    }
  }
  if (leafSlot < 0) return buf

  // Walk parentUuid to root. Collect kept-message line starts and the kept byte
  // total. A dangling parent (uuid not in file) is the normal termination for
  // forked sessions and post-boundary chains.
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

  // PARALLEL-TOOL SAFETY: if ANY tool_result is off the single-parent chain, the
  // parser's message.id sibling-group recovery is in play and this byte prune
  // cannot faithfully reproduce it — bail to the full buffer (see the file header).
  for (let i = 0; i < msgIdx.length; i += 3) {
    if (entryIsToolResult.get(i) && !chain.has(msgIdx[i])) return buf
  }

  // Only stitch if we would drop at least half the buffer (parse cost scales with
  // bytes; near break-even the concat memcpy dominates).
  if (len - chainBytes < len >> 1) return buf

  // Merge kept entries with metadata in original file order.
  const parts = []
  let m = 0
  for (let i = 0; i < msgIdx.length; i += 3) {
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

// Of several `"uuid":"` matches in one line that each carry the `","timestamp":"`
// suffix, pick the one at JSON nesting depth 1 (the top-level object's field), or
// the last candidate if none are at depth 1.
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
