// Decide whether a freshly-stat'd global config file is UNCHANGED relative to
// what is already cached — i.e. whether the freshness watcher should SKIP the
// re-read. `true` = unchanged, skip; `false` = re-read.
//
// The watcher compares the file's real FS mtime against the cache's mtime. The
// write-through now stores the file's REAL mtimeMs + size (stat-after-write, so
// both sides come from the SAME clock), so our own write reads back as
// currMtime === cacheMtime with an equal size → skip. A coarse-granularity FS
// (1 s / 2 s mtime) or a same-second EXTERNAL write can also land on
// currMtime === cacheMtime; there the SIZE is the tiebreak — a different size
// is a real external update → re-read. The previous `<=` gate had no tiebreak,
// so it silently SHADOWED a same-tick external write (the cache served stale
// config until the next mtime-advancing write).
//
//   currMtime > cacheMtime → unambiguously newer file → re-read (false)
//   currMtime < cacheMtime → cache already reflects this stat or a newer one
//                            (incl. the file-gone curr.mtimeMs === 0 callback,
//                            where cacheMtime is a real/overshoot value) → skip
//   currMtime === cacheMtime → size is the only discriminator
//
// @param {number} currMtime  the just-stat'd file mtimeMs
// @param {number} currSize   the just-stat'd file size in bytes
// @param {number} cacheMtime the cached mtimeMs
// @param {number|null|undefined} cacheSize the size that pairs with cacheMtime
// @returns {boolean} true when unchanged (skip the re-read)
export function configIsUnchanged(currMtime, currSize, cacheMtime, cacheSize) {
  if (currMtime > cacheMtime) return false
  if (currMtime < cacheMtime) return true
  // Same mtime tick → fall to the size tiebreak.
  if (typeof cacheSize !== 'number' || typeof currSize !== 'number') {
    // No size to compare (e.g. a write-through whose post-write stat failed and
    // fell back to a clock mtime with no stored size). Preserve the old
    // mtime-only `<=` behavior: equal mtime ⇒ treat as our own write, skip.
    return true
  }
  return currSize === cacheSize
}
