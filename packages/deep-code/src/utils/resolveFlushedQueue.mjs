// The new pending-history queue after a flush attempt.
//
// immediateFlushHistory snapshots the pending entries, clears the buffer, then
// awaits the disk write. Previously it cleared BEFORE the write and the catch
// only logged — so a transient appendFile failure (disk full, EACCES) silently
// DROPPED that batch. This computes the buffer to restore:
//   - succeeded → the batch is durably written; keep only `laterEntries`
//     (entries pushed WHILE the write was in flight — addToPromptHistory appends
//     regardless of the isWriting flush guard).
//   - failed → re-queue the batch AHEAD of `laterEntries` so the next flush
//     retries it; oldest-first order is preserved.
//
// @template T
// @param {T[]} flushedBatch  the entries this flush attempted to write
// @param {T[]} laterEntries  entries added during the write (the live buffer)
// @param {boolean} succeeded
// @returns {T[]}
export function resolveFlushedQueue(flushedBatch, laterEntries, succeeded) {
  return succeeded ? laterEntries : flushedBatch.concat(laterEntries)
}
