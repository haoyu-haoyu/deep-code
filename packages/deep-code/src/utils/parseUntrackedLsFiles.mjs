import { unquoteGitPath } from './unquoteGitPath.mjs'

/**
 * Parse `git ls-files --others` (untracked) output into real filesystem paths.
 *
 * The ls-files call must pass `-c core.quotepath=false` so a non-ASCII filename
 * is emitted raw rather than C-quoted with octal escapes (\nnn). Without it the
 * raw quoted string (e.g. "\346\226\260.txt") is fed straight to stat(), which
 * fails with ENOENT, and the file is silently skipped. Even WITH quotepath=false
 * git still C-quotes a name containing a double-quote, backslash, tab, or
 * newline, so each line is run through unquoteGitPath to recover the actual path
 * (a no-op for an already-raw name). A quoted name never contains a literal
 * newline, so splitting on newline stays safe.
 *
 * @param {string} stdout  raw stdout of `git -c core.quotepath=false ls-files --others ...`
 * @returns {string[]} the decoded untracked paths
 */
export function parseUntrackedLsFiles(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  return trimmed.split('\n').filter(Boolean).map(unquoteGitPath)
}
