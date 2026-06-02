// Pure per-tick processing for the Bash-output poller (TaskOutput's shared
// poll loop). Extracted from TaskOutput.ts so the bug-prone bits — the
// stale-callback GENERATION guard, the adaptive idle backoff, the line
// count/extrapolation, and the byte-correct chunkDelta — are unit-testable
// under `node --test` (the .ts class itself is not importable there). The class
// keeps the I/O (tailFileRaw), the timer, and the field storage; this module
// owns the math.

import { decodeUtf8AtBoundary } from '../utf8Tail.mjs'

/**
 * Adaptive idle backoff: should the shared poller SKIP this tick for an entry?
 * The caller toggles `skipParity` (0/1) on every tick BEFORE calling, so an
 * idle entry (>= idleThreshold consecutive empty ticks) is polled every OTHER
 * tick rather than every tick.
 */
export function shouldSkipIdleTick(consecutiveEmptyTicks, skipParity, idleThreshold) {
  return consecutiveEmptyTicks >= idleThreshold && skipParity === 0
}

/**
 * Process one resolved tailFile read into { next poll state, onProgress payload }.
 *
 * @param {object} args
 * @param {{buffer: Buffer, bytesRead: number, bytesTotal: number}} args.read
 *   the tailFileRaw result (tail buffer, bytes in it, full file size).
 * @param {number} args.capturedGen generation when the read was ISSUED.
 * @param {number} args.currentGen  the entry's generation NOW.
 * @param {{totalLines:number, totalBytes:number, lastSeenBytesTotal:number,
 *   consecutiveEmptyTicks:number, lastEmittedBytesTotal:number}} args.state
 * @param {number} args.lastLinesCount  trailing lines for the preview slice.
 * @param {number} args.allLinesCount   trailing lines for the verbose slice.
 *
 * @returns {{stale:true}} when the read is stale (generation advanced) and MUST
 *   be dropped — no state mutation, no emit. Otherwise
 *   `{stale:false, state:{…}, progress:{lastLines, allLines, totalLines,
 *   totalBytes, isIncomplete, chunkDelta}}`.
 */
export function processTailRead({
  read,
  capturedGen,
  currentGen,
  state,
  lastLinesCount,
  allLinesCount,
}) {
  // STALE-CALLBACK GUARD: a later tick (or a startPolling reset) advanced the
  // generation while this read was in flight. Drop it entirely — applying its
  // bookkeeping would walk the byte cursors backward and emit an old snapshot.
  if (capturedGen !== currentGen) return { stale: true }

  const { buffer, bytesRead, bytesTotal } = read
  let { totalLines, totalBytes, lastSeenBytesTotal, consecutiveEmptyTicks, lastEmittedBytesTotal } = state

  // Adaptive bookkeeping: did the file grow this tick?
  if (bytesTotal > lastSeenBytesTotal) {
    consecutiveEmptyTicks = 0
    lastSeenBytesTotal = bytesTotal
  } else {
    consecutiveEmptyTicks++
  }

  // No bytes in the tail — still emit (empty) so the progress loop wakes up and
  // can check for backgrounding. bytesRead===0 happens when the file is size 0
  // OR on a truncation-during-read race (stat saw bytesTotal>0 but the read got
  // 0 bytes), so bytesTotal is NOT necessarily 0 here. Report the read's
  // bytesTotal in BOTH the state and the emit so the field tracks the file size
  // (the prior value would lag/disagree with the emitted progress). totalLines /
  // lastEmitted are left untouched (only the adaptive counters + size moved).
  if (bytesRead === 0) {
    return {
      stale: false,
      state: { totalLines, totalBytes: bytesTotal, lastSeenBytesTotal, consecutiveEmptyTicks, lastEmittedBytesTotal },
      progress: { lastLines: '', allLines: '', totalLines, totalBytes: bytesTotal, isIncomplete: false, chunkDelta: '' },
    }
  }

  // Decode the tail at a UTF-8 codepoint boundary (the slice start may land
  // mid-codepoint when the tail buffer is smaller than the file).
  const content = decodeUtf8AtBoundary(buffer, 0, bytesRead)

  // Count LINES in the tail and capture the slice points for the last N / all N.
  // A single trailing '\n' TERMINATES the last line — it must not add a phantom
  // empty line — so we skip it before walking. Lines = (internal newlines) + 1
  // for the final line when the content is non-empty. (`a\nb\n` and `a\nb` are
  // both 2 lines; `\n` is 1 blank line; `\n\n` is 2.)
  let nLast = 0
  let nAll = 0
  let newlineCount = 0
  let from =
    content.length > 0 && content.charCodeAt(content.length - 1) === 10
      ? content.length - 1
      : content.length
  while (from > 0) {
    const nl = content.lastIndexOf('\n', from - 1)
    if (nl < 0) break
    newlineCount++
    if (newlineCount === lastLinesCount) nLast = nl + 1
    if (newlineCount === allLinesCount) nAll = nl + 1
    from = nl
  }
  const lineCount = content.length === 0 ? 0 : newlineCount + 1

  // Exact when the whole file fits in the tail; otherwise extrapolate from the
  // sample, kept monotone so the counter never regresses on a long-line tick.
  const totalLinesOut =
    bytesRead >= bytesTotal
      ? lineCount
      : Math.max(totalLines, Math.round((bytesTotal / bytesRead) * lineCount))

  // Byte-correct chunk delta: slice the RAW buffer by byte count, realign to a
  // UTF-8 boundary, decode. Undersampling (file grew by more than the tail can
  // hold) hands back the full aligned tail.
  const newBytes = Math.max(0, bytesTotal - lastEmittedBytesTotal)
  let chunkDelta = ''
  if (newBytes > 0 && bytesRead > 0) {
    const cutFromEnd = Math.min(newBytes, bytesRead)
    chunkDelta = decodeUtf8AtBoundary(buffer, bytesRead - cutFromEnd, bytesRead)
  }

  return {
    stale: false,
    state: {
      totalLines: totalLinesOut,
      totalBytes: bytesTotal,
      lastSeenBytesTotal,
      consecutiveEmptyTicks,
      lastEmittedBytesTotal: bytesTotal,
    },
    progress: {
      lastLines: content.slice(nLast),
      allLines: content.slice(nAll),
      totalLines: totalLinesOut,
      totalBytes: bytesTotal,
      isIncomplete: bytesRead < bytesTotal,
      chunkDelta,
    },
  }
}
