// Classify a leading home-directory shortcut (`~`) in a path and return the
// portion AFTER the shortcut (to be joined onto the home directory), or null
// when the path is not a home shortcut.
//
// `~`  -> ''            (the home directory itself)
// `~/x` -> 'x'          (POSIX separator, every platform)
// `~\x` -> 'x'          (Windows separator) ONLY when platform === 'windows'
// anything else -> null
//
// The backslash form is Windows-GATED on purpose: on POSIX a backslash is a
// legal filename character, so a literal file named `~\foo` must NOT be
// mis-expanded to `<home>/foo`. On Windows `\` is the native separator, so
// `~\Documents` is the natural sibling of `~/Documents` (mirrors how
// PowerShellTool/pathValidation.ts treats `~/` and `~\` together).
//
// Returning the bare `~` as '' lets the caller preserve its exact prior
// behavior for that case (return the home directory verbatim, without routing
// it through path.join) while still funneling separator/platform classification
// through this single tested point.
/**
 * @param {string} trimmedPath an already-trimmed path
 * @param {string} platform the current platform (e.g. 'windows', 'macos', 'linux')
 * @returns {string | null} the path after the `~` shortcut, or null if not a home shortcut
 */
export function splitHomeShortcut(trimmedPath, platform) {
  if (trimmedPath === '~') {
    return ''
  }
  if (trimmedPath.startsWith('~/')) {
    return trimmedPath.slice(2)
  }
  if (platform === 'windows' && trimmedPath.startsWith('~\\')) {
    return trimmedPath.slice(2)
  }
  return null
}
