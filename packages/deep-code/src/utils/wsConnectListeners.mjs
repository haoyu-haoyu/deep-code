/**
 * Attach one-shot connect-time 'open'/'error' listeners to a `ws`-style emitter
 * (EventEmitter `on`/`off`), removing BOTH as soon as EITHER fires.
 *
 * This is the connect-handshake settle contract: exactly one of open/error
 * resolves the connection attempt, and the temporary listeners must come off
 * the socket at that point so that
 *   (1) they do not leak past the handshake (the closures, and the settled
 *       resolve/reject they capture, stay attached for the socket's lifetime
 *       otherwise), and
 *   (2) a LATER 'error' on an already-connected socket does NOT re-fire the
 *       connect-time error handler — which would mis-log a post-connect
 *       transient error as a connection failure and reject an already-settled
 *       promise, in addition to the persistent message/error handler.
 *
 * The Bun (native WebSocket) branch of WebSocketTransport already removes its
 * temp open/error listeners on settle; this mirrors that contract for the
 * Node `ws` branch, which previously registered anonymous handlers that were
 * never removed.
 *
 * @param {{ on: (event: string, listener: (...args: any[]) => void) => unknown,
 *           off: (event: string, listener: (...args: any[]) => void) => unknown }} emitter
 * @param {() => void} onOpen   invoked once, on the first 'open'
 * @param {(error: unknown) => void} onError  invoked once, on the first 'error'
 * @returns {void}
 */
export function attachOneShotConnectListeners(emitter, onOpen, onError) {
  const handleOpen = () => {
    emitter.off('open', handleOpen)
    emitter.off('error', handleError)
    onOpen()
  }
  const handleError = error => {
    emitter.off('open', handleOpen)
    emitter.off('error', handleError)
    onError(error)
  }
  emitter.on('open', handleOpen)
  emitter.on('error', handleError)
}
