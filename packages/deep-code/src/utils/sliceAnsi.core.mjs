import {
  ansiCodesToString,
  reduceAnsiCodes,
  tokenize,
  undoAnsiCodes,
} from '@alcalzone/ansi-tokenize'

// A code is an "end code" if its code equals its endCode (e.g., hyperlink close).
function isEndCode(code) {
  return code.code === code.endCode
}

// Filter to only include "start codes" (not end codes).
function filterStartCodes(codes) {
  return codes.filter(c => !isEndCode(c))
}

/**
 * Display-cell-aware slice of a string containing ANSI escape codes.
 *
 * The vendored tokenizer emits each contiguous non-ANSI run as ONE text token,
 * so the historical loop advanced `position` by the WHOLE run's width and could
 * never cut inside it: `sliceAnsi('hello world', 0, 5)` returned the entire
 * 11-cell string (truncate / overflow=hidden defeated), and a truncate-start
 * `sliceAnsi(s, 30, 49)` jumped 0→49 in one step and returned '' (visible-tail
 * data loss). The fix walks a TEXT token grapheme-by-grapheme — but only when
 * it straddles `start` or `end`. Tokens that lie entirely before `start`,
 * entirely within `[start, end)`, or entirely past `end` keep the original
 * atomic handling, so the common case stays byte-identical and does no
 * per-grapheme work.
 *
 * deps:
 *   stringWidth(str): number        — display width in cells
 *   splitGraphemes(str): string[]   — grapheme clusters (memoized Intl.Segmenter)
 */
export default function sliceAnsi(str, start, end, deps) {
  const { stringWidth, splitGraphemes } = deps
  const tokens = tokenize(str)
  let activeCodes = []
  let position = 0
  let result = ''
  let include = false

  // Flip into the slice: reduce/filter the codes seen so far and seed `result`
  // with the active start codes (identical to the historical inline block).
  const enterInclude = () => {
    include = true
    activeCodes = filterStartCodes(reduceAnsiCodes(activeCodes))
    result = ansiCodesToString(activeCodes)
  }

  for (const token of tokens) {
    if (token.type === 'ansi') {
      // An ANSI code at/after `end` only opens a style run that would leak into
      // the undo sequence — stop (matches the old `ansi || width>0 || !include`
      // break, whose `ansi` arm always fired here).
      if (end !== undefined && position >= end) break
      activeCodes.push(token)
      if (include) result += token.code
      continue
    }

    const width = token.fullWidth ? 2 : stringWidth(token.value)
    const crossesStart =
      !include && position < start && position + width > start
    const crossesEnd =
      end !== undefined && position < end && position + width > end

    if (!crossesStart && !crossesEnd) {
      // Atomic fast path — byte-identical to the historical per-token behavior.
      if (end !== undefined && position >= end) {
        // Break AFTER trailing zero-width marks: a width-0 mark attaches to the
        // preceding base char, so it must ride along even past `end`.
        if (width > 0 || !include) break
      }
      if (!include && position >= start) {
        // Skip leading zero-width marks at the start boundary — they belong to
        // the preceding base char in the left half (only when start > 0).
        if (start > 0 && width === 0) continue
        enterInclude()
      }
      if (include) result += token.value
      position += width
      continue
    }

    // Straddling text token: walk graphemes so the cut lands on a real cell
    // boundary. Grapheme clustering keeps emoji ZWJ sequences and base+combining
    // pairs intact (never split mid-cluster).
    let stop = false
    for (const grapheme of splitGraphemes(token.value)) {
      // A single-grapheme token reuses the already-computed width (and honors
      // fullWidth); multi-grapheme runs measure each cluster.
      const gw = grapheme === token.value ? width : stringWidth(grapheme)
      if (end !== undefined && position >= end) {
        if (gw > 0 || !include) {
          stop = true
          break
        }
      }
      if (!include && position >= start) {
        if (start > 0 && gw === 0) continue
        enterInclude()
      }
      if (include) result += grapheme
      position += gw
    }
    if (stop) break
  }

  // Only undo start codes that are still active.
  const activeStartCodes = filterStartCodes(reduceAnsiCodes(activeCodes))
  result += ansiCodesToString(undoAnsiCodes(activeStartCodes))
  return result
}
