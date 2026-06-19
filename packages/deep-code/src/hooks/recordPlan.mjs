// Decide how useLogMessages should record the current messages array to the
// transcript: an incremental tail append, a same-head shrink, or a full rebuild.
//
// useLogMessages treats the array as append-only between compactions and only
// passes messages.slice(prevLength) to recordTranscript. That assumes the
// recorded prefix [0, prevLength) is UNCHANGED. A fullscreen `/summarize`-from-a-
// message (direction='from') breaks the assumption: it keeps messages[0] (so the
// first-uuid discriminator stays "incremental") and GROWS the array, but splices
// a FRESH compact_boundary at an interior index < prevLength. The incremental
// tail slice starts PAST that boundary, so the boundary (and its preservedSegment
// metadata) is never persisted — leaving a phantom leaf that surfaces as a
// duplicate session entry in /insights.
//
// Discriminator: the recorded prefix is intact iff the uuid at index
// (prevLength - 1) is unchanged from what we last recorded there. A pure append
// leaves it unchanged; any interior insert/rewrite (the `from` rebuild) shifts
// it. When an otherwise-incremental render's tail uuid no longer matches, record
// the FULL array so recordTranscript re-scans (dedup-skipping the kept prefix and
// any prior boundary) and persists the freshly-inserted boundary.
//
// O(1) per render (one uuid compare) — preserves the hook's explicit
// avoid-O(n)-per-setMessages optimization. For every non-`from` shape this guard
// is a no-op, so the plan is byte-identical to the prior discriminator.
//
// @param {{
//   wasFirstRender: boolean,
//   currentFirstUuid: string | undefined,
//   prevFirstUuid: string | undefined,
//   prevLength: number,
//   currentLength: number,
//   uuidAtPrevTailIndex: string | undefined,   // messages[prevLength - 1]?.uuid
//   prevRecordedTailUuid: string | undefined,  // uuid last recorded at that index
// }} input
// @returns {{ startIndex: number, isIncremental: boolean, isSameHeadShrink: boolean }}
export function resolveRecordPlan({
  wasFirstRender,
  currentFirstUuid,
  prevFirstUuid,
  prevLength,
  currentLength,
  uuidAtPrevTailIndex,
  prevRecordedTailUuid,
}) {
  const sameHead =
    currentFirstUuid !== undefined &&
    !wasFirstRender &&
    currentFirstUuid === prevFirstUuid
  // The recorded prefix is structurally intact only if its last element is the
  // same message we recorded there. A `from` rebuild GROWS the array and splices
  // an interior boundary, shifting messages[prevLength-1] → force a full rebuild
  // so the boundary lands on disk.
  //
  // The guard applies ONLY on a STRICT grow. A same-length render stays
  // incremental (→ early-returns, recording nothing) exactly as before — this
  // preserves the ephemeral-progress same-length replacement (REPL.tsx), which
  // swaps the last message for a new-uuid tick that MUST NOT be persisted
  // (it would bloat the transcript with per-second sleep/bash ticks). A
  // same-length render and the ephemeral swap are indistinguishable by the
  // signals here, so the rare same-length `from` rebuild is an accepted miss —
  // the common case grows.
  const prefixIntact = uuidAtPrevTailIndex === prevRecordedTailUuid
  const isIncremental =
    sameHead &&
    prevLength <= currentLength &&
    (prevLength === currentLength || prefixIntact)
  const isSameHeadShrink = sameHead && prevLength > currentLength
  const startIndex = isIncremental ? prevLength : 0
  return { startIndex, isIncremental, isSameHeadShrink }
}
