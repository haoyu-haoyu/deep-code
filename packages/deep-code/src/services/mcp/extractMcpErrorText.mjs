// Extract the human-readable message from an MCP tool result that has
// isError: true.
//
// The MCP spec allows the error content array to hold multiple blocks in any
// order — a spec-valid error may LEAD with a non-text block (image / resource)
// and carry the real message in a later text block. Reading only content[0]
// dropped that message and surfaced "Unknown error" instead. Scan every
// top-level text block and join them.
//
// Structure matches the original: when content is present and non-empty, use its
// text blocks (or the fallback if none) — the legacy top-level `error` field is
// only consulted when there is no content array (an older error shape).
//
// Top-level `text` only: an embedded-resource block carries its text at
// `block.resource.text`, NOT `block.text`, so it is correctly not pulled in.
export function extractMcpErrorText(result, fallback = 'Unknown error') {
  if (
    result &&
    typeof result === 'object' &&
    'content' in result &&
    Array.isArray(result.content) &&
    result.content.length > 0
  ) {
    const texts = result.content
      .filter(
        block =>
          block &&
          typeof block === 'object' &&
          'text' in block &&
          typeof block.text === 'string',
      )
      .map(block => block.text)
    return texts.length > 0 ? texts.join('\n') : fallback
  }
  if (result && typeof result === 'object' && 'error' in result) {
    return String(result.error)
  }
  return fallback
}
