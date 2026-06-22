/**
 * Constants related to tool result size limits
 */

/**
 * Default maximum size in characters for tool results before they get persisted
 * to disk. When exceeded, the result is saved to a file and the model receives
 * a preview with the file path instead of the full content.
 *
 * Individual tools may declare a lower maxResultSizeChars, but this constant
 * acts as a system-wide cap regardless of what tools declare.
 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000

/**
 * Maximum size for tool results in tokens.
 * Based on analysis of tool result sizes, we set this to a reasonable upper bound
 * to prevent excessively large tool results from consuming too much context.
 *
 * This is approximately 400KB of text (assuming ~4 bytes per token).
 */
export const MAX_TOOL_RESULT_TOKENS = 100_000

/**
 * Bytes per token estimate for calculating token count from byte size.
 * This is a conservative estimate - actual token count may vary.
 */
export const BYTES_PER_TOKEN = 4

/**
 * Maximum size for tool results in bytes (derived from token limit).
 */
export const MAX_TOOL_RESULT_BYTES = MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN

/**
 * Default maximum aggregate size in characters for tool_result blocks within
 * a SINGLE user message (one turn's batch of parallel tool results). When a
 * message's blocks together exceed this, the largest blocks in that message
 * are persisted to disk and replaced with previews until under budget.
 * Messages are evaluated independently — a 150K result in one turn and a
 * 150K result in the next are both untouched.
 *
 * This prevents N parallel tools from each hitting the per-tool max and
 * collectively producing e.g. 10 × 40K = 400K in one turn's user message.
 *
 * Overridable at runtime via GrowthBook flag tengu_hawthorn_window — see
 * getPerMessageBudgetLimit() in toolResultStorage.ts.
 */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000

/**
 * Maximum aggregate size in characters for ALL MCP-resource @-mention text
 * injected in a SINGLE turn. The per-resource render cap
 * (DEFAULT_MAX_RESULT_SIZE_CHARS) bounds one @server:uri resource, but the mention
 * COUNT is unbounded (extractMcpResourceMentions only dedups), so without a running
 * per-turn budget N mentions could each inject a fresh 50K of server-controlled
 * text. This is the cumulative ceiling — 4 × the per-resource cap, matching the
 * per-message tool-result aggregate above and mirroring RELEVANT_MEMORIES_CONFIG's
 * cumulative MAX_SESSION_BYTES gate. Enforced via mcpResourceBudget.mjs at the
 * per-turn convergence point (processMcpResourceAttachments).
 */
export const MAX_TURN_MCP_RESOURCE_CHARS = 4 * DEFAULT_MAX_RESULT_SIZE_CHARS

/**
 * Bounds for a teammate mailbox file (the per-agent JSON IPC queue). The inbox
 * is rewritten in full under a lock on every send, and read tombstones were
 * never pruned, so a flood or a giant single message would blow up the model
 * context + cause O(N^2) IO. Enforced in writeToMailbox via inboxBound.mjs.
 * Structured control messages (shutdown/permission/plan) are EVICTION-LAST and
 * never truncated (a flood sheds plain peer chatter first), but NOT immune — the
 * `isProtected` test keys off the forgeable message body, so once only protected
 * messages remain over a cap the oldest is evicted as a last resort, keeping the
 * cap absolute (a forged-"protected" flood cannot reopen the unbounded DoS).
 * Values are generous so a legitimate exchange never reaches eviction.
 */
// Per-message body cap — one "unit of content" (mirrors DEFAULT_MAX_RESULT_SIZE_CHARS);
// a full plan/diff fits, a multi-MB message is truncated (non-structured only).
export const MAX_MAILBOX_MESSAGE_CHARS = DEFAULT_MAX_RESULT_SIZE_CHARS
// Summary preview cap — the documented "5-10 word summary".
export const MAX_MAILBOX_SUMMARY_CHARS = 200
// Retained-message count cap — generous: a teammate draining every poll interval
// never nears this; it bounds a tiny-message flood's array/XML-block count.
export const MAX_MAILBOX_MESSAGES = 1_000
// Total inbox text cap — generous (~20 max-size messages); bounds the file/IO and
// the unread bytes a poller could concatenate into the model context.
export const MAX_MAILBOX_TOTAL_CHARS = 1_000_000

/**
 * Maximum character length for tool summary strings in compact views.
 * Used by getToolUseSummary() implementations to truncate long inputs
 * for display in grouped agent rendering.
 */
export const TOOL_SUMMARY_MAX_LENGTH = 50
