// Single source of truth for "is this transcript line a compact_boundary?",
// shared by BOTH the in-chunk scanner and the seam-straddle scanner in
// readTranscriptForLoad so they cannot diverge on what counts as a boundary.
//
// The straddle path historically gated on a leading `{"type":"system"` prefix,
// but every transcript message — including the boundary — is serialized with
// `parentUuid` as the FIRST key, so a real on-disk boundary line begins
// `{"parentUuid":null,...,"type":"system","subtype":"compact_boundary",...}`.
// That prefix gate therefore NEVER matched a boundary straddling a read-chunk
// seam, so the pre-compact truncation (and preservedSegment detection) was
// silently skipped for it. Detect by the marker the in-chunk path already uses.

export const COMPACT_BOUNDARY_MARKER = '"compact_boundary"'

/**
 * Confirm a byte-matched line is a real compact_boundary (the marker can appear
 * inside user content) and report whether it carries a preservedSegment.
 *
 * @param {string} line one JSONL line (without the trailing newline)
 * @returns {{ hasPreservedSegment: boolean } | null} null when not a boundary
 */
export function parseCompactBoundaryLine(line) {
  // Cheap pre-filter: a boundary line always contains the marker. This both
  // fast-paths the common (non-boundary) line and replaces the dead prefix gate
  // on the straddle path.
  if (!line.includes(COMPACT_BOUNDARY_MARKER)) return null
  try {
    const parsed = JSON.parse(line)
    if (parsed.type !== 'system' || parsed.subtype !== 'compact_boundary') {
      return null
    }
    return {
      hasPreservedSegment: Boolean(parsed.compactMetadata?.preservedSegment),
    }
  } catch {
    return null
  }
}
