/**
 * Drain `items` from `startIndex`, enriching each via `enrichOne` (an independent
 * async per-item read), collecting the first `count` NON-falsy results, reading in
 * bounded-concurrent chunks of `chunkSize` instead of one-at-a-time.
 *
 * This is the concurrent replacement for /resume's serial enrichLogs loop. Its
 * output is IDENTICAL to that serial scan, which is the whole point — progressive
 * pagination depends on it:
 *  - `results` are in SOURCE ORDER and are exactly the first `count` items for
 *    which enrichOne returned a truthy value (a falsy/null result is filtered and
 *    does NOT count), same as the serial `if (enriched) result.push(...)`;
 *  - `nextIndex` is the index right AFTER the item that produced the count-th kept
 *    result (or items.length if the list ended first), so the next call resumes
 *    exactly where the serial scan would have — never skipping nor re-keeping an
 *    item. Items read past that point within the final chunk are concurrently
 *    fetched but discarded (and re-read on the next call), bounded by chunkSize-1.
 *
 * Equivalence to the serial loop is pinned by a differential test (the serial loop
 * is the oracle). `chunkSize <= 1` degenerates to exactly serial behaviour.
 *
 * @template T, R
 * @param {object} args
 * @param {T[]} args.items
 * @param {number} args.startIndex
 * @param {number} args.count                       stop after this many kept results
 * @param {number} args.chunkSize                   concurrency window (>=1)
 * @param {(item: T) => Promise<R>} args.enrichOne  returns the enriched value, or a
 *                                                  falsy value to filter the item out
 * @returns {Promise<{ results: R[]; nextIndex: number }>}
 */
export async function drainEnrichedInChunks({
  items,
  startIndex,
  count,
  chunkSize,
  enrichOne,
}) {
  const results = []
  let i = startIndex
  const step = Math.max(1, Math.floor(chunkSize) || 1)

  while (i < items.length && results.length < count) {
    const end = Math.min(i + step, items.length)
    // Each enrichOne is independent (its own buffer), so the chunk reads run
    // concurrently; results are consumed strictly in source order below.
    const enriched = await Promise.all(items.slice(i, end).map(item => enrichOne(item)))
    let reachedCount = false
    for (const value of enriched) {
      i++
      if (value) {
        results.push(value)
        if (results.length >= count) {
          reachedCount = true
          break
        }
      }
    }
    if (reachedCount) break
  }

  return { results, nextIndex: i }
}
