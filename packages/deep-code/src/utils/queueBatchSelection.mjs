// Which queued commands run together in the next REPL drain cycle.
//
// `orderedMainThread` is the queue's main-thread commands in EFFECTIVE DISPATCH
// ORDER (priority, then queue index — the exact order repeated dequeue() pulls
// them). The selection:
//   - a slash-command or bash head runs ALONE (per-command error isolation /
//     individual routing);
//   - a plain-prompt head batches only the CONTIGUOUS following same-mode prompts,
//     STOPPING at the first slash / bash / different-mode command so that command
//     keeps its queue position and runs first.
//
// The bug this fixes: the REPL used a POSITION-AGNOSTIC dequeueAllMatching that
// scooped every same-mode prompt regardless of position, jumping OVER a sandwiched
// /clear (or /compact, /model, or a bash command) — so for a queue
// [prompt1, /clear, prompt2] it ran [prompt1, prompt2] as one turn and only then
// /clear, violating FIFO (prompt2 ran in the un-cleared context). The SDK/print.ts
// drain never had this bug — it batches the contiguous leading run via
// peek/dequeue + canBatchWith. This restores that order-preserving property.
//
// Pure value-in/value-out so the ordering rule is node-testable (the queue
// manager is bun-tainted). The batch criterion intentionally mirrors the prior
// REPL one (same-mode, non-slash) — only the position-agnostic scan is fixed.
//
// @param {Array<{ mode?: string }>} orderedMainThread  main-thread commands in dispatch order
// @param {(cmd: { value?: unknown }) => boolean} isSlashCommand
// @returns {Array} the commands to run together this cycle (a slice of the input, same refs)
export function selectQueueDrainBatch(orderedMainThread, isSlashCommand) {
  const head = orderedMainThread[0]
  if (!head) return []

  // Slash + bash heads are processed individually.
  if (isSlashCommand(head) || head.mode === 'bash') {
    return [head]
  }

  const targetMode = head.mode
  const batch = [head]
  for (let i = 1; i < orderedMainThread.length; i++) {
    const cmd = orderedMainThread[i]
    // Stop at the first command that breaks the contiguous same-mode prompt run
    // (a slash command, a bash command, or any other mode) — it keeps its FIFO
    // position and runs on the next cycle, BEFORE the prompts queued behind it.
    if (isSlashCommand(cmd) || cmd.mode !== targetMode) break
    batch.push(cmd)
  }
  return batch
}
