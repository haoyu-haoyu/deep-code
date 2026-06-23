/**
 * Detect the unified-diff "\ No newline at end of file" marker line.
 *
 * In a hunk's line list every REAL line is prefixed with ' ', '+', or '-';
 * the no-newline marker is the only line prefixed with '\' (backslash). The
 * `diff` npm package (structuredPatch) inserts the literal
 * `\ No newline at end of file` whenever a side lacks a trailing newline, and it
 * is NOT counted in the hunk's oldLines/newLines totals.
 *
 * Renderers that classify any non-+/- line as a context line otherwise (a) show
 * the marker as a phantom file line reading "  No newline at end of file" and
 * (b) advance the old/new line-number counters past it, mis-numbering every line
 * that follows. So it must be dropped from the rendered line list.
 *
 * @param {string} line  a raw hunk line (with its leading +/-/space/backslash)
 * @returns {boolean}
 */
export function isNoNewlineMarker(line) {
  return typeof line === 'string' && line.charCodeAt(0) === 0x5c // '\'
}

/**
 * Drop the "no newline at end of file" marker line(s) from a hunk's line list,
 * for RENDERING only. Producers (e.g. getPatchFromContents) deliberately keep
 * the marker in hunk.lines because reconcilePatchEdits reconstructs edits from
 * it — so the strip belongs in the render layer, not the producer.
 *
 * Returns the SAME array reference when there is no marker (the common case),
 * so it neither allocates nor disturbs identity-keyed render caches.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
export function stripNoNewlineMarkerLines(lines) {
  return lines.some(isNoNewlineMarker)
    ? lines.filter(line => !isNoNewlineMarker(line))
    : lines
}
