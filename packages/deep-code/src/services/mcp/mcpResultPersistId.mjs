// Build the persistId for a large MCP text/JSON result that gets written to disk
// (processMCPResult → persistToolResult).
//
// persistToolResult writes with flag 'wx' and, on EEXIST, SILENTLY falls through
// while still returning the CURRENT call's preview/size against the EXISTING
// file's path. That skip is only safe when the id is unique per invocation — its
// own contract is "tool_use_id is unique per invocation and content is
// deterministic for a given id". A `mcp-<server>-<tool>-<Date.now()>` id is NOT
// unique: two concurrent calls to the SAME server+tool (read-only tools run in
// parallel) landing in the same millisecond produce the SAME id with DIFFERENT
// content, so the second call's tool_result points the model at the FIRST call's
// data — silent wrong-success.
//
// Append a random suffix so each invocation gets a distinct id (the sibling blob
// path, persistBlobToTextBlock, already does exactly this). `normalizedServer`
// and `normalizedTool` are pre-normalized by the caller (normalizeNameForMCP) so
// this leaf stays dependency-free and node-testable.
export function mcpLargeResultPersistId(normalizedServer, normalizedTool) {
  const timestamp = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `mcp-${normalizedServer}-${normalizedTool}-${timestamp}-${rand}`
}
