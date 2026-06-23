// Extract a file-diff's path from its lines, robust to a path containing a
// literal ` b/` substring (e.g. a directory named `a b`).
//
// The header line `a/X b/Y` was parsed with `^a/(.+?) b/(.+)$` — a non-greedy
// `(.+?)` that splits at the FIRST ` b/`, so modifying `a b/c.txt` (dir `a b`)
// gives header `a/a b/c.txt b/a b/c.txt` and the regex returns the wrong path
// `c.txt b/a b/c.txt`, which never matches the `a b/c.txt` numstat key → the
// file is mislabeled as an un-expandable "large file" in the Diff dialog.
//
// The `+++ b/<path>` and `--- a/<path>` lines are SINGLE-path forms and so are
// immune to that ambiguity. Prefer the `+++ b/` destination path (present for a
// modified/new file); fall back to `--- a/` (a deletion, whose `+++` is
// `/dev/null`); and finally to the legacy `a/X b/Y` regex (mode-only / binary
// diffs that have neither line). The scan is bounded to before the first hunk
// so a hunk-body line that happens to start with `+++ b/` can't shadow the real
// header.
//
// (With `core.quotepath=false` git emits non-ASCII paths raw; it still appends a
// trailing TAB to a `+++`/`---` path that contains spaces, so strip from the
// first TAB. A name containing a `"`/`\`/tab/newline is still C-quoted even under
// quotepath=false — `+++ "b/has\"q.txt"` — so the quoted form is decoded via
// unquoteGitPath, which the numstat key parser shares so the two paths join.)

import { unquoteGitPath } from './unquoteGitPath.mjs'

function stripTrailingTab(path) {
  const i = path.indexOf('\t')
  return i === -1 ? path : path.slice(0, i)
}

/**
 * Parse the path out of a `+++ `/`--- ` header's payload, handling both the
 * unquoted (`b/path`) and the git C-quoted (`"b/has\"q.txt"`) forms.
 * @param {string} rest        the text after `+++ ` / `--- `
 * @param {string} sidePrefix  `b/` or `a/`
 * @returns {string | null}
 */
function sidePath(rest, sidePrefix) {
  if (rest.startsWith('"')) {
    // C-quoted: the quotes wrap the whole `b/<path>`; decode then drop `b/`.
    const decoded = unquoteGitPath(rest)
    return decoded.startsWith(sidePrefix)
      ? decoded.slice(sidePrefix.length)
      : null
  }
  return rest.startsWith(sidePrefix)
    ? stripTrailingTab(rest.slice(sidePrefix.length))
    : null
}

/**
 * @param {string[]} lines - the lines of one file-diff (the chunk after
 *   `diff --git `, already split on '\n'; lines[0] is the `a/X b/Y` header).
 * @returns {string | null} the file path, or null if no header could be parsed.
 */
export function extractDiffFilePath(lines) {
  let plusPath
  let minusPath
  for (const line of lines) {
    if (line.startsWith('@@')) break // reached the first hunk — stop scanning
    if (plusPath === undefined && line.startsWith('+++ ')) {
      const p = sidePath(line.slice('+++ '.length), 'b/')
      if (p !== null) plusPath = p
    } else if (minusPath === undefined && line.startsWith('--- ')) {
      const m = sidePath(line.slice('--- '.length), 'a/')
      if (m !== null) minusPath = m
    }
  }
  if (plusPath !== undefined) return plusPath
  if (minusPath !== undefined) return minusPath

  // Fallback for diffs with no +++/--- path lines (mode-only changes, binary
  // files). The legacy regex mis-splits a ` b/`-substring path, but those diffs
  // carry no hunks so the key only feeds the (already-correct for non-` b/`)
  // perFileStats join.
  const headerMatch = lines[0]?.match(/^a\/(.+?) b\/(.+)$/)
  if (!headerMatch) return null
  return headerMatch[2] ?? headerMatch[1] ?? ''
}
