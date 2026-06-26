/**
 * Write a batch of queued transcript entries to a file in size-bounded chunks,
 * resolving each entry's enqueue promise as soon as the chunk containing it is
 * durably appended.
 *
 * This is the inner loop of the session write-queue drain, extracted so the
 * crash/failure accounting is unit-testable. The behavior on the happy path is
 * identical to the previous inline loop: accumulate serialized lines until
 * adding the next would reach `maxChunkBytes`, append the accumulated chunk,
 * resolve its entries, then continue.
 *
 * The important change is failure handling. The caller has ALREADY spliced
 * `batch` out of the live queue, so if an append throws (disk full, EACCES,
 * NFS timeout — after appendToFile's own mkdir retry) the un-appended entries
 * would be silently lost. Instead this returns the unwritten remainder so the
 * caller can re-queue it for the next drain (mirroring the prompt-history
 * re-queue, resolveFlushedQueue / #566). Entries whose chunk WAS appended are
 * resolved and excluded from the remainder; the failing chunk and everything
 * after it are returned unresolved.
 *
 * @template T
 * @param {Array<{ entry: T, resolve: () => void }>} batch  spliced queue items
 * @param {(content: string) => Promise<void>} append       durably append a chunk
 * @param {(entry: T) => string} serialize                  entry -> one JSON line (no trailing newline)
 * @param {number} maxChunkBytes                            flush boundary
 * @returns {Promise<{ unwritten: Array<{ entry: T, resolve: () => void }>, error: Error | null }>}
 *          on success: { unwritten: [], error: null }; on failure: the remainder + the error
 */
export async function drainBatchChunks(batch, append, serialize, maxChunkBytes) {
  let content = ''
  // Index into `batch` of the first entry NOT yet durably appended. Advanced
  // only AFTER a successful append, so on a throw `batch.slice(chunkStart)` is
  // exactly the failing chunk plus every entry the loop had not reached yet.
  let chunkStart = 0
  try {
    for (let i = 0; i < batch.length; i++) {
      const line = serialize(batch[i].entry) + '\n'
      if (content.length + line.length >= maxChunkBytes) {
        await append(content)
        for (let j = chunkStart; j < i; j++) batch[j].resolve()
        chunkStart = i
        content = ''
      }
      content += line
    }
    if (content.length > 0) {
      await append(content)
      for (let j = chunkStart; j < batch.length; j++) batch[j].resolve()
      chunkStart = batch.length
    }
    return { unwritten: [], error: null }
  } catch (error) {
    return {
      unwritten: batch.slice(chunkStart),
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
