// The @alcalzone/ansi-tokenize "deepcode-shim" is a git-tracked vendored package
// that is NOT declared in package.json — `npm ci` wipes it on CI, so a bare
// import from this .mjs leaf (or its test) fails with ERR_MODULE_NOT_FOUND. The
// production runtime is unaffected because sliceAnsi.ts is bundled into dist
// (the shim inlined), but a node --test leaf is not. So the four functions this
// leaf needs are vendored here VERBATIM from that shim's entry (index.js,
// version 0.0.0-deepcode-shim) — byte-identical to the bundled production
// behavior, and self-contained so it runs under a clean `npm ci`.
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)/g

function endCodeFor(code) {
  if (code === '\x1b[0m') return code
  if (code === '\x1b[7m') return '\x1b[27m'
  if (code.startsWith('\x1b]8;')) return '\x1b]8;;\x1b\\'
  return '\x1b[0m'
}

export function tokenize(input = '') {
  const text = String(input)
  const tokens = []
  let lastIndex = 0
  let match

  while ((match = ANSI_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        value: text.slice(lastIndex, match.index),
        fullWidth: false,
      })
    }
    tokens.push({
      type: 'ansi',
      code: match[0],
      value: match[0],
      endCode: endCodeFor(match[0]),
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex), fullWidth: false })
  }

  return tokens
}

export function reduceAnsiCodes(codes = []) {
  const result = []
  for (const code of codes) {
    if (!code) continue
    if (code.code === '\x1b[0m' || code.code === code.endCode) {
      result.length = 0
      continue
    }
    result.push(code)
  }
  return result
}

export function undoAnsiCodes(codes = []) {
  return [...codes]
    .reverse()
    .map(code => ({ ...code, code: code.endCode, endCode: code.endCode }))
}

export function ansiCodesToString(codes = []) {
  return codes.map(code => code.code || '').join('')
}

// A code is an "end code" if its code equals its endCode (e.g., hyperlink close).
function isEndCode(code) {
  return code.code === code.endCode
}

// Filter to only include "start codes" (not end codes).
function filterStartCodes(codes) {
  return codes.filter(c => !isEndCode(c))
}

/**
 * Isolated per-grapheme widths IF the width oracle is ADDITIVE over this run
 * (`Σ stringWidth(gᵢ) === runWidth`) — i.e. each grapheme's standalone width
 * equals its in-context contribution, so the widths are exact and a cut at any
 * cell boundary measures correctly. Returns `null` when the oracle is NOT
 * additive over the run, signalling the caller to NOT sub-cut it.
 *
 * `Bun.stringWidth` (the production oracle) is non-additive for some content —
 * a VS16 emoji-presentation char abutting a wide/CJK char, keycaps,
 * regional-indicator flags, some Thai / Devanagari: `stringWidth(a+b) ≠
 * stringWidth(a)+stringWidth(b)`. For such a run there is NO per-grapheme cell
 * assignment that matches `stringWidth` of an arbitrary sub-range (a substring's
 * standalone width differs from its in-context contribution), so any sub-cut
 * can render wider than its window and overwrite sibling columns. Those runs
 * fall back to whole-token atomic handling — lossless for wrap tiling and
 * identical to the pre-change behavior, so no regression.
 */
function additiveGraphemeWidths(graphemes, runWidth, stringWidth) {
  const isolated = graphemes.map(g => stringWidth(g))
  let sum = 0
  for (const w of isolated) sum += w
  return sum === runWidth ? isolated : null
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
 * it straddles `start`/`end` AND the width oracle is additive over its
 * graphemes (see additiveGraphemeWidths). Tokens that lie entirely before
 * `start`, within `[start, end)`, past `end`, are full-width, or are a
 * non-additive run keep the original atomic handling, so the common case stays
 * byte-identical and does no per-grapheme work.
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
    // Sub-cut a straddling text token grapheme-by-grapheme ONLY when (a) it is
    // not a single full-width char and (b) the width oracle is additive over
    // its graphemes. A full-width char can't be sub-cut; a non-additive run has
    // no faithful per-grapheme cell mapping (see additiveGraphemeWidths). Both
    // fall through to the historical atomic handling.
    let graphemes = null
    let graphemeWidths = null
    if (!token.fullWidth) {
      const wouldStraddle =
        (!include && position < start && position + width > start) ||
        (end !== undefined && position < end && position + width > end)
      if (wouldStraddle) {
        const gs = splitGraphemes(token.value)
        const widths = additiveGraphemeWidths(gs, width, stringWidth)
        if (widths !== null) {
          graphemes = gs
          graphemeWidths = widths
        }
      }
    }

    if (graphemes === null) {
      // Atomic path — byte-identical to the historical per-token behavior.
      // Covers non-straddling tokens, full-width chars, and non-additive runs.
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

    // Straddling additive text token: walk graphemes so the cut lands on a real
    // cell boundary. The isolated widths are exact (additive), and grapheme
    // clustering keeps emoji ZWJ sequences and base+combining pairs intact.
    let stop = false
    for (let i = 0; i < graphemes.length; i++) {
      const grapheme = graphemes[i]
      const gw = graphemeWidths[i]
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
