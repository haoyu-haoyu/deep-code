/**
 * Does a finished hook's result block the action it gates?
 *
 * A hook blocks when it exits with code 2 (the documented "blocking feedback"
 * convention) OR when it prints a sync JSON object with `decision: "block"`.
 * Async hooks never block from here — they are backgrounded and finalized
 * later, so their interim result is always treated as non-blocking.
 *
 * This is the SINGLE source of truth shared by both hook-execution paths:
 *   - executeHooks (interactive REPL)
 *   - executeHooksOutsideREPL (headless `-p` / SDK)
 * They previously computed this inline and DRIFTED: the REPL path ran stdout
 * through JSON parsing first and, because an empty `{}` validates, returned
 * success before ever reaching its `status === 2` branch — so a PreToolUse /
 * UserPromptSubmit / Stop deny-hook that also emitted JSON failed OPEN, while
 * the headless path blocked correctly. Routing both through this leaf keeps
 * them from diverging again.
 *
 * @param {{ status: number, json?: unknown, isAsync?: boolean, capExceeded?: boolean }} input
 *   status      - the hook process exit code
 *   json        - the parsed (validated) hook stdout JSON, if any
 *   isAsync     - whether `json` is an async hook response (default false)
 *   capExceeded - whether the hook was KILLED for blowing the output cap. Such a
 *                 hook never cleanly emitted its decision (its exit-2 / block-JSON
 *                 may have been cut off mid-stream), so the gated action must fail
 *                 CLOSED — block it rather than let a truncated hook silently allow.
 * @returns {boolean} true when the gated action must be blocked
 */
export function hookOutputBlocks({
  status,
  json = null,
  isAsync = false,
  capExceeded = false,
}) {
  if (capExceeded) return true
  if (isAsync) return false
  if (status === 2) return true
  return (
    !!json &&
    typeof json === 'object' &&
    json.decision === 'block'
  )
}
