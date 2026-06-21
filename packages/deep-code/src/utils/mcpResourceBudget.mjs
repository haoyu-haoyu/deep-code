// Per-turn aggregate budget for MCP-resource @-mention text injection.
//
// buildMcpResourceTextBlocks (mcpResourceBlocks.mjs) caps ONE resource's text at a
// passed maxChars, but the mention COUNT is unbounded — extractMcpResourceMentions
// only dedups — and each @server:uri becomes its own attachment rendered with a
// FRESH DEFAULT_MAX_RESULT_SIZE_CHARS budget. So a single connected (content-
// untrusted) MCP server could supply both the prompt body (embedding hundreds of
// distinct @server:uri mentions = COUNT) and oversized resource bodies (SIZE),
// injecting multi-MB of server-controlled text into one turn — a context-window /
// token-cost DoS. This mirrors RELEVANT_MEMORIES_CONFIG's cumulative MAX_SESSION_
// BYTES gate: one running budget across all resources in a turn, so N resources
// can't each ride under the per-resource cap.
//
// Pure value-in/value-out so the budget math is node-testable (the wiring in
// attachments.ts / messages.ts is bun-tainted).

// Remaining allowance for the next resource given the running total already used.
// A non-finite cap means "unbounded" (Infinity); a finite cap clamps to >= 0 so an
// over-budget turn stamps 0 (= truncate everything for the trailing resources, with
// the leaf's "use ReadMcpResourceTool for the rest" instruction).
export function nextResourceAllowance(cap, used) {
  if (!Number.isFinite(cap)) return Infinity
  return Math.max(0, cap - (Number.isFinite(used) ? used : 0))
}

// Total text-char length of a ReadResourceResult.contents array — counting ONLY
// the text items, matching how buildMcpResourceTextBlocks draws down its budget:
// blob items render a small length-clamped marker and (by the "do not consume the
// text budget" contract) never draw down the text budget, so they're excluded here
// too and `used` stays exactly aligned with the rendered text. NOTE: the per-turn
// aggregate therefore bounds the TEXT channel (the DoS finding); the blob-marker
// count and the MCP server-`instructions` delta are separate, smaller channels left
// as follow-ups.
export function mcpResourceContentLength(contents) {
  if (!Array.isArray(contents)) return 0
  let total = 0
  for (const item of contents) {
    if (item && typeof item === 'object' && typeof item.text === 'string') {
      total += item.text.length
    }
  }
  return total
}
