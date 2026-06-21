import { createHash } from 'node:crypto'

// A tool_use id becomes the on-disk spill filename — getToolResultPath joins it
// straight into the per-session tool-results dir: join(dir, `${id}.${ext}`).
// persistToolResult passes the VERBATIM model tool_use id, which the trust model
// classifies as attacker-influenced for a malicious / MITM DeepSeek provider
// (deepseek-call-model.mjs sets `id: event.id ?? …` from the stream). path.join
// NORMALIZES but does NOT CONFINE '..', so an id like '../../../../tmp/pwned'
// resolves OUTSIDE the session dir and writeFile creates an out-of-tree file —
// an internal side-effect that never passes through the Write tool or any
// permission / folder-trust gate (so it fires even with no write permission and
// in plan mode).
//
// The project already treats model-controlled ids as a traversal risk
// EVERYWHERE ELSE: the READ side guards this exact path (permissions/filesystem.ts
// rejects a 'tool-results/..' escape) and the MCP persist path builds its id from
// normalizeNameForMCP'd parts plus a random suffix (mcpResultPersistId.mjs). Only
// this main tool_use_id path interpolated the raw id — an oversight, closed here.
//
// A genuine Anthropic `toolu_*` id, the deepseek `toolu_deepseek_<uuid>` fallback,
// and the app-generated task UUIDs that BashTool/PowerShellTool pass are all safe
// filename components → returned VERBATIM, preserving the same-id→same-file
// contract that lets microcompact's message replay skip a re-write via the 'wx'
// EEXIST check (and keeps the model-visible filepath stable). Any id that is not a
// plain `[A-Za-z0-9_-]` token (path separators, '.', '..', NUL, anything else) is
// replaced by a deterministic sha256 hex digest, which (a) is a single confined
// filename component that cannot traverse and (b) stays deterministic per id, so
// the EEXIST replay-skip and the embedded filepath remain stable.
//
// Pure value-in/value-out (node:crypto only) so it is node-testable
// (toolResultStorage.ts is bun-tainted).

const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/

// Windows reserved device names: `CON.txt` (and CON/NUL/COM1/… with ANY or no
// extension) resolve to the device, not a file in the dir — a malicious provider
// id of `CON` would misdirect the persist write on Windows. They pass SAFE_ID, so
// reject them explicitly and let them fall to the hash branch.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

export function safeToolResultIdComponent(id) {
  if (typeof id === 'string' && SAFE_ID.test(id) && !WINDOWS_RESERVED.test(id)) {
    return id
  }
  return 'sha256-' + createHash('sha256').update(String(id)).digest('hex')
}
