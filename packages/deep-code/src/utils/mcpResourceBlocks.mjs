// Render an MCP resource's `contents` (from resources/read) into the text blocks
// that get injected into the model context for an @server:uri mention.
//
// Why a size cap: an @-mention resource read returns server-controlled content of
// UNKNOWN size (resources/list exposes only metadata — name/uri/mimeType — not
// the byte length), and this render path is the SOLE place that text enters the
// model context. Every other text-bearing attachment is bounded (the @-file read
// limit, the 2000-char IDE-selection truncation) and the sibling tool form
// (ReadMcpResourceTool, maxResultSizeChars) is bounded by the tool-result
// pipeline's DEFAULT_MAX_RESULT_SIZE_CHARS clamp — but this attachment render was
// the one uncapped path, so a single huge resource could blow the context window
// / inflate cost in one turn. We mirror the tool's system-wide ceiling here.
//
// The cap is a running TOTAL budget across all text items (matching the tool's
// whole-result bound, not a per-item one), so N items can't each ride just under
// the cap. Once truncated, the trailing "you already have the full contents"
// reassurance is replaced with an instruction to use ReadMcpResourceTool for the
// rest (the model does NOT have the full contents).
//
// Pure value-in/value-out so the cap + block shape is node-testable (messages.ts,
// the sole caller, is bun-tainted).
//
// @param {Array<unknown>} contents  the ReadResourceResult.contents array
// @param {number} [maxChars]  total text budget. Any FINITE number is a hard cap
//   (a negative value clamps to 0 = truncate everything); only a non-finite
//   sentinel (undefined / NaN / Infinity) means unbounded — so a future caller
//   passing a computed `cap - used` budget can't silently get unlimited injection.
// @returns {Array<{type:'text', text:string}>}
export function buildMcpResourceTextBlocks(contents, maxChars) {
  const blocks = []
  if (!Array.isArray(contents)) return blocks
  let budget = Number.isFinite(maxChars) ? Math.max(0, maxChars) : Infinity

  for (const item of contents) {
    if (!item || typeof item !== 'object') continue

    if ('text' in item && typeof item.text === 'string') {
      const text = item.text
      if (text.length <= budget) {
        blocks.push(
          { type: 'text', text: 'Full contents of resource:' },
          { type: 'text', text },
          {
            type: 'text',
            text: 'Do NOT read this resource again unless you think it may have changed, since you already have the full contents.',
          },
        )
        budget -= text.length
      } else {
        const kept = budget > 0 ? budget : 0
        const omitted = text.length - kept
        blocks.push(
          { type: 'text', text: 'Full contents of resource (truncated):' },
          {
            type: 'text',
            text:
              text.slice(0, kept) +
              `\n... (truncated; ${omitted} of ${text.length} chars omitted — use the ReadMcpResourceTool to read the full resource)`,
          },
        )
        budget = 0
      }
    } else if ('blob' in item) {
      const mimeType =
        'mimeType' in item ? String(item.mimeType) : 'application/octet-stream'
      blocks.push({ type: 'text', text: `[Binary content: ${mimeType}]` })
    }
  }

  return blocks
}
