/**
 * Return directory entries sorted by name, deterministically.
 *
 * fs.readdir yields entries in a filesystem-dependent order (differs by OS,
 * filesystem, and on-disk layout). For .deepcode/rules/*.md the load order is
 * the precedence order the model sees (later files are higher priority), so an
 * unsorted readdir makes the SAME repo produce different instruction precedence
 * on different checkouts/machines. Sorting by name makes it stable and
 * predictable (e.g. 00-base.md before 10-override.md).
 *
 * Uses a code-unit (UTF-16) comparison, NOT localeCompare: localeCompare depends
 * on the host locale / ICU version, which would reintroduce cross-machine
 * nondeterminism — the very thing this sort exists to remove. Code-unit ordering
 * is total and identical everywhere.
 *
 * Returns a NEW array; the input is not mutated. Sorts by `.name`, working for
 * fs.Dirent[] (withFileTypes) or any { name: string }[].
 *
 * @template {{ name: string }} T
 * @param {T[]} entries
 * @returns {T[]} a new array sorted by name
 */
export function sortDirentsByName(entries) {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
