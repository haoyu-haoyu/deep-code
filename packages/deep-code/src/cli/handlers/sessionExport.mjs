import { exportSession } from '../../utils/sessionDetail.mjs'

// CLI handler for `deepcode session export <id> [--format markdown|json]`. Streams
// the rendered transcript to stdout via the pure core. A missing session reports
// to STDERR (not stdout) so piping the export to a file is never polluted. Returns
// the result so the command can set a non-zero exit. Core injectable.
export async function exportSessionHandler({
  sessionId,
  format = 'markdown',
  exportSessionFn = exportSession,
  sessionDir,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const fmt = format === 'json' ? 'json' : 'markdown'

  // One 'error' listener for the whole export so a stream error is never an
  // UNCAUGHT throw (and is surfaced afterward). Per-chunk completion, backpressure,
  // AND per-write errors all come through the write() CALLBACK, which fires once
  // the chunk is flushed or fails — awaiting it bounds memory and never mistakes
  // "no backpressure" for "write succeeded".
  const canListen = typeof stdout.on === 'function' && typeof stdout.off === 'function'
  let streamError = null
  const onStreamError = err => {
    if (!streamError) streamError = err
  }
  if (canListen) stdout.on('error', onStreamError)

  const write = chunk =>
    new Promise((resolve, reject) => {
      if (streamError) {
        reject(streamError)
        return
      }
      try {
        stdout.write(chunk, err => (err ? reject(err) : resolve()))
      } catch (err) {
        reject(err) // synchronous write() throw
      }
    })

  try {
    const result = await exportSessionFn({ sessionId, sessionDir, format: fmt, write })
    if (streamError) throw streamError // a stream error not tied to a pending write
    if (!result.exists) {
      stderr.write(`Session ${sessionId} not found for this project.\n`)
    }
    return result
  } finally {
    if (canListen) stdout.off('error', onStreamError)
  }
}
