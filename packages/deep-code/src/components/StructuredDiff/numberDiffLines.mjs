/**
 * @typedef {object} DiffLineLike
 * @property {string} code
 * @property {'add'|'remove'|'nochange'} type
 * @property {number} i
 * @property {string} originalCode
 * @property {boolean} [wordDiff]
 * @property {DiffLineLike} [matchedLine]
 */

/**
 * Assign 1-based display line numbers to a diff hunk.
 *
 * A run of consecutive `remove` lines shares the line numbers of the lines that
 * follow it (the removed text occupied those positions in the OLD file), so the
 * counter is advanced across the run and then rewound by the number of removed
 * lines — matching how a unified diff numbers deletions.
 *
 * Iterates with an index pointer rather than consuming a copy with
 * `Array.prototype.shift()`: shift re-indexes the whole backing array on every
 * call, so the old `const queue = [...diff]` + repeated `queue.shift()` (outer
 * loop plus the inner remove-run loop) was O(n^2) over the diff line count and
 * also made a full upfront copy purely to consume it destructively. The index
 * walk is O(n), allocates nothing extra, and produces a byte-identical result.
 *
 * @param {DiffLineLike[]} diff
 * @param {number} startLine
 * @returns {DiffLineLike[]}
 */
export function numberDiffLines(diff, startLine) {
  let i = startLine
  /** @type {DiffLineLike[]} */
  const result = []
  let idx = 0
  while (idx < diff.length) {
    const current = diff[idx++]
    const { code, type, originalCode, wordDiff, matchedLine } = current
    const line = { code, type, i, originalCode, wordDiff, matchedLine }

    // Update counters based on change type
    switch (type) {
      case 'nochange':
        i++
        result.push(line)
        break
      case 'add':
        i++
        result.push(line)
        break
      case 'remove': {
        result.push(line)
        let numRemoved = 0
        while (diff[idx]?.type === 'remove') {
          i++
          const current = diff[idx++]
          const { code, type, originalCode, wordDiff, matchedLine } = current
          const line = { code, type, i, originalCode, wordDiff, matchedLine }
          result.push(line)
          numRemoved++
        }
        i -= numRemoved
        break
      }
    }
  }
  return result
}
