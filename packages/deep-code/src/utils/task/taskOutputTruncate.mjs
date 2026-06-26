import { truncateEndAtCodeUnitBoundary } from '../truncateAtCodeUnitBoundary.mjs'

// Pure truncation core for formatTaskOutput.
//
// Task output that exceeds the configured cap is truncated to its last N
// characters with a "[Truncated. Full output: <path>]" header prepended. The
// previous math was `availableSpace = maxLen - header.length` followed by
// `output.slice(-availableSpace)`.
//
// getMaxTaskOutputLength accepts any positive integer from TASK_MAX_OUTPUT_LENGTH
// (validateBoundedIntEnvVar only rejects <= 0), so maxLen can be smaller than the
// header (the header embeds the task-output file path, ~50-100+ chars). When
// header.length > maxLen, availableSpace goes negative and `output.slice(-neg)`
// becomes `output.slice(pos)` — which drops only the FIRST `pos` characters and
// returns almost the ENTIRE output, the exact opposite of truncating. The result
// is labelled "[Truncated...]" while leaking nearly everything, blowing past the
// cap the user explicitly set.
//
// Clamp availableSpace to >= 0 and, when there's no room for any tail, emit just
// the header. The header itself is mandatory, so the content may still exceed a
// pathologically small maxLen by the header length — but it can never again
// return more than `header.length + max(0, maxLen - header.length)` characters.
//
// The tail is kept with truncateEndAtCodeUnitBoundary rather than a raw
// `slice(-availableSpace)`: this output is model-facing (embedded in the Task
// tool_result <output> block), and a bare slice can begin on the low half of an
// astral character (emoji / CJK extension) when the cut lands mid-pair, leaking a
// lone surrogate into the API JSON. The boundary-safe helper drops the broken
// half; for ASCII / non-boundary tails it is byte-identical to slice(-N).
export function truncateTaskOutput(output, maxLen, header) {
  if (output.length <= maxLen) {
    return { content: output, wasTruncated: false }
  }
  const availableSpace = Math.max(0, maxLen - header.length)
  const truncated = truncateEndAtCodeUnitBoundary(output, availableSpace)
  return { content: header + truncated, wasTruncated: true }
}
