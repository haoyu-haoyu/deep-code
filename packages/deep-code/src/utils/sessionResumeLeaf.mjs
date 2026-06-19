// Pick the conversation leaf (tip) to reconstruct the chain from on resume.
//
// Every reconstruction site EXCEPT `getLastSessionLog` (the `--resume <sid>`
// route) anchors on the latest (max-timestamp) message that is a real LEAF
// (`leafUuids.has(uuid)`) AND a user/assistant turn — `loadFullLog`,
// `loadTranscriptFromFile`, the byte-level pruner. `getLastSessionLog` instead
// used a raw `!isSidechain` max-timestamp pick, which also admits 'system' /
// 'attachment' entries and NON-leaf interior nodes, so the SAME file
// reconstructs a different chain depending on the resume route (and, under a
// non-monotonic wall clock, can anchor an interior node whose later-appended
// descendants are then excluded by the backward parentUuid walk — silent turn
// loss). This leaf is the single source of that rule.
//
// `findLatestMessage` semantics, reproduced exactly: max `Date.parse(timestamp)`
// with a strict `>` so ties keep the FIRST-iterated message.

function findLatest(messages, predicate) {
  let latest
  let maxTime = -Infinity
  for (const m of messages) {
    if (!predicate(m)) continue
    const t = Date.parse(m.timestamp)
    if (t > maxTime) {
      maxTime = t
      latest = m
    }
  }
  return latest
}

/**
 * @param {Iterable<{uuid: string, timestamp: string, isSidechain?: boolean, type?: string}>} messages
 * @param {{ has(uuid: string): boolean }} leafUuids
 * @returns the chosen leaf message, or undefined if none.
 */
export function selectResumeLeaf(messages, leafUuids) {
  // Materialize: the caller passes a one-shot iterator (Map.values()).
  const all = Array.isArray(messages) ? messages : [...messages]
  const leaf = findLatest(
    all,
    m =>
      !m.isSidechain &&
      leafUuids.has(m.uuid) &&
      (m.type === 'user' || m.type === 'assistant'),
  )
  // No qualifying non-sidechain user/assistant leaf → FAIL SAFE with undefined
  // (mirrors conversationRecovery.ts, which returns an empty result on no-tip),
  // NOT the prior raw `!isSidechain` max-timestamp pick. That fallback re-admitted
  // the exact interior-node anchor this leaf exists to remove: a 'system' /
  // 'attachment' node whose later-appended descendants are then excluded by
  // buildConversationChain's backward parentUuid walk (silent turn loss).
  //
  // INVARIANT making the fallback unreachable for real files: leafUuids ⊆
  // {user,assistant} (sessionStorage.ts leaf computation) and the main session
  // file never holds isSidechain:true entries (those route to a separate agent
  // file), so for any native transcript with a non-sidechain user/assistant
  // message the rule above already matched. This branch is reached only for a
  // degenerate/foreign transcript with no qualifying leaf, where undefined is
  // correct (callers degrade gracefully). A "relaxed leaf" fallback would be
  // dead code — every leaf is already user/assistant — so undefined is the only
  // sound, non-redundant choice.
  return leaf
}
