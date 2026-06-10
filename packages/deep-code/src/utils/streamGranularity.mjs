/**
 * Streaming-text visibility granularity for the REPL's "AI is typing"
 * preview.
 *
 *   - 'char' : show every char as it arrives (Claude Code's default; most
 *              live "typing" feel; can flicker mid-word in unstable
 *              terminals)
 *   - 'word' : truncate to last whitespace boundary (smoother visual
 *              cadence at the cost of slightly trailing the model)
 *   - 'line' : truncate to last newline (legacy upstream DeepCode default;
 *              short replies that fit on one line never appear until
 *              message_stop arrives)
 *
 * Pure JS / no src/* imports so this module is loadable directly by
 * `node --test` without the Bun-build harness.
 */

const VALID = new Set(['char', 'word', 'line'])

// Whitespace OR Unicode punctuation. Anything else is treated as part of
// a word for the no-Intl.Segmenter fallback. This keeps trailing periods
// / commas / question marks visible (they're "completed" tokens — the
// model finished a sentence) while still rewinding when the input ends
// mid-word.
const WORD_BOUNDARY_PATTERN = /[\s\p{P}]/u

/**
 * Read the granularity preference from env vars. DeepCode-branded name
 * wins on conflict. Invalid values fall back to the default.
 */
export function streamingTextGranularity(env = process.env) {
  const explicit =
    pickStringEnv(env, 'DEEPCODE_STREAM_GRANULARITY') ??
    pickStringEnv(env, 'CLAUDE_CODE_STREAM_GRANULARITY')
  if (explicit && VALID.has(explicit)) return explicit
  return 'char'
}

function pickStringEnv(env, name) {
  const raw = env[name]
  if (raw === undefined || raw === null) return undefined
  const trimmed = String(raw).trim().toLowerCase()
  return trimmed === '' ? undefined : trimmed
}

// Intl.Segmenter (Stage 4 since Node 18) gives us Unicode-aware word
// boundaries — works for English ("hello world"), Chinese ("你好世界"),
// Japanese, etc. without needing whitespace in the source. Falls back to
// the whitespace-only path when Segmenter is unavailable so the helper
// still functions on environments without it.
const wordSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

/**
 * Truncate streaming text to the configured granularity. Returns null
 * when the truncated result would be empty (used as the "nothing to
 * show yet" signal upstream).
 */
export function truncateToBoundary(text, granularity) {
  if (!text) return null
  if (granularity === 'char') return text

  if (granularity === 'word') {
    if (wordSegmenter) {
      // Cut so the last visible piece is a COMPLETED segment.
      //   - If the trailing segment is non-word-like (whitespace,
      //     punctuation), it's complete — include it.
      //   - If it's word-like, the user might still be typing it, so
      //     rewind to its start (the last completed boundary).
      // This keeps trailing periods, commas, and spaces visible while
      // hiding mid-word state (`hello wor` → `hello `, not `hello wor`).
      // Read ONLY the last segment via containing(text.length - 1) — equivalent to the
      // last element of [...segment(text)] but without materializing (and GC-ing) the
      // whole segment array on every render. The preview re-truncates the growing stream
      // text on each frame, so spreading the full iterator made it O(n^2) over a turn;
      // containing() seeks the boundary local to the end. text is non-empty here (guarded
      // above), so the last code unit — and thus its segment — always exists.
      const last = wordSegmenter.segment(text).containing(text.length - 1)
      if (!last) return null
      if (last.isWordLike === false) {
        // Trailing separator / punctuation — include it.
        return text
      }
      // Trailing word-like segment may still be in flight. Rewind to
      // its start so we only show completed words. boundary === 0
      // means the entire text is one in-progress word.
      const boundary = last.index
      if (boundary <= 0) return null
      const slice = text.slice(0, boundary)
      return slice.length > 0 ? slice : null
    }
    return truncateWordsFallback(text)
  }

  // 'line' — match the legacy upstream behavior exactly: substring up
  // to and including the last newline. Returns null when there is no
  // complete line yet so the caller hides the preview entirely.
  const newlineIdx = text.lastIndexOf('\n')
  if (newlineIdx < 0) return null
  const slice = text.slice(0, newlineIdx + 1)
  return slice.length > 0 ? slice : null
}

/**
 * Word-boundary truncation without Intl.Segmenter. Exported so it can
 * be tested directly on runtimes that DO have Intl.Segmenter; the live
 * path uses Segmenter when available and only falls back here on older
 * environments. Walks backward looking for whitespace OR Unicode
 * punctuation:
 *   - If the last char is a boundary, the trailing run is "completed"
 *     (whitespace + punctuation suffix); include it.
 *   - Otherwise rewind to the last boundary char to drop any
 *     in-flight word at the end.
 */
export function truncateWordsFallback(text) {
  if (!text) return null
  let i = text.length - 1
  if (WORD_BOUNDARY_PATTERN.test(text[i])) {
    return text
  }
  while (i >= 0 && !WORD_BOUNDARY_PATTERN.test(text[i])) i--
  if (i < 0) return null
  const slice = text.slice(0, i + 1)
  return slice.length > 0 ? slice : null
}
