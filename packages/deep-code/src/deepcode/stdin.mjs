// Drain a non-TTY stdin-like stream, but give up if no first chunk arrives within
// `timeoutMs`. An inherited-but-idle non-TTY descriptor — e.g. a parent that spawns
// `deepcode` with stdio:['pipe', …] then never writes nor closes the write end —
// never yields and never ends, so an unbounded `for await (… of process.stdin)`
// hangs the process forever with no output. This mirrors the full-CLI's
// peekForStdinData guard (src/utils/process.ts) for the native entrypoint's stdin
// read, so `deepcode --compact` (and the native single-turn path) fail with a clear
// error instead of hanging when stdin is an open-but-idle pipe.
//
// The first chunk cancels the idle timeout; after that we accumulate to `end`
// unconditionally (the caller needs the whole input, not just the first chunk) —
// the same contract as peekForStdinData. On timeout we invoke `onTimeout` (a
// stderr warning) and resolve '' so the caller's empty-input branch reports a
// clear error instead of hanging.

export const STDIN_PEEK_TIMEOUT_MS = 3000

/**
 * @param {NodeJS.ReadableStream & NodeJS.EventEmitter} stream
 * @param {number} timeoutMs
 * @param {{ onTimeout?: () => void, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} [options]
 * @returns {Promise<string>} the trimmed accumulated input, or '' on idle timeout
 */
export function readStdinWithTimeout(
  stream,
  timeoutMs,
  { onTimeout, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  // Decode bytes to UTF-8 as they arrive. Flowing 'data' events emit one chunk
  // per producer write, so without a StringDecoder a multibyte character split
  // across two writes (e.g. '€' as [0xE2] then [0x82,0xAC]) would be stringified
  // independently and corrupted. setEncoding installs a StringDecoder that holds
  // incomplete sequences across chunks — matching the full CLI's
  // process.stdin.setEncoding('utf8') and the old paused-iteration behavior.
  stream.setEncoding?.('utf8')

  return new Promise((resolve, reject) => {
    let input = ''
    let settled = false
    let receivedData = false

    const cleanup = () => {
      clearTimer(timer)
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onError)
    }
    const onData = chunk => {
      if (!receivedData) {
        receivedData = true
        // A real producer is writing — cancel the idle timeout and wait for end.
        clearTimer(timer)
      }
      input += chunk
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(input.trim())
    }
    const onError = error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const timer = setTimer(() => {
      // A chunk may have raced in just before the timer fired; the end path owns
      // resolution once any data has arrived.
      if (settled || receivedData) return
      settled = true
      cleanup()
      if (onTimeout) onTimeout()
      resolve('')
    }, timeoutMs)

    stream.on('data', onData)
    stream.once('end', onEnd)
    stream.once('error', onError)
  })
}
