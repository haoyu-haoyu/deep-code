// Remove the elicitation queue entry for a specific (serverName, requestId).
// That pair is the unique identity of an in-flight elicitation — requestId is
// unique per server connection, and the REPL keys the dialog on
// `${serverName}:${requestId}`.
//
// Used on the ABORT path: when an elicitation request's AbortSignal fires
// (request cancelled / timed out / connection closed) before the user responds,
// the handler resolves the promise with `cancel`, but nothing removed the queue
// entry — so a stale dialog stayed pinned at queue[0], holding `hasActivePrompt`
// true and blocking input until the user manually dismissed a dead prompt.
//
// Filter by identity rather than the REPL's `slice(1)` head-removal: an aborted
// elicitation is not necessarily at the head when several are queued, and only
// the head is ever rendered/responded-to, so slice(1) would drop the WRONG one.
//
// @param {Array<{serverName: string, requestId: string|number}>} queue
// @param {string} serverName
// @param {string|number} requestId
// @returns a new queue array without the matching entry (a no-match returns an
//   equivalent array — callers always replace the queue, so referential
//   identity is irrelevant)
export function removeElicitationFromQueue(queue, serverName, requestId) {
  return queue.filter(
    e => !(e.serverName === serverName && e.requestId === requestId),
  )
}
