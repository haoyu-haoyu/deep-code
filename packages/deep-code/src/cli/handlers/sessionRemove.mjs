import { removeSession } from '../../utils/sessionDetail.mjs'

// CLI handler for `deepcode session rm <id>`. Deletes the transcript + its
// sub-agent subdir via the pure core, then reports. Returns the result so the
// command can set a non-zero exit when nothing matched. Core injectable.
export async function removeSessionHandler({
  sessionId,
  removeSessionFn = removeSession,
  sessionDir,
  stdout = process.stdout,
} = {}) {
  const result = await removeSessionFn({ sessionId, sessionDir })

  if (!result.existed) {
    stdout.write(`Session ${sessionId} not found for this project (nothing removed).\n`)
    return result
  }

  stdout.write(`Removed session ${sessionId} (${result.removed.length} path${result.removed.length === 1 ? '' : 's'}).\n`)
  return result
}
