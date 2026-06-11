// Derive the colon-namespaced command path from a directory relative to a plugin
// base dir (e.g. `<base>/foo/bar` → `"foo:bar"`, `<base>` → `""`). Extracted as a
// node-testable leaf because the original inline logic was POSIX-only: on Windows
// the path separators are backslashes, so slicing the base prefix left `"\foo\bar"`,
// which the `/^\//` strip and the `/`-split both miss — yielding a broken
// `"\foo:bar"` namespace and a command name like `plugin:\foo:bar` whose
// slash-command lookup never matches.
//
// Mirrors the win32 handling already used for `${CLAUDE_SKILL_DIR}` in
// loadPluginCommands.ts: normalize backslashes to `/` ONLY on win32, because a
// POSIX path component may legitimately CONTAIN a literal backslash that must not
// be treated as a separator. Byte-identical to the previous inline behavior on
// every non-win32 platform.

/**
 * @param {string} dir directory whose path under `baseDir` becomes the namespace
 * @param {string} baseDir the plugin commands/skills base directory
 * @param {{ platform?: NodeJS.Platform }} [options] injectable platform for tests
 * @returns {string} colon-joined namespace, or '' when `dir` is `baseDir` (or not under it)
 */
export function relativeNamespace(dir, baseDir, { platform = process.platform } = {}) {
  if (typeof dir !== 'string' || typeof baseDir !== 'string') return ''
  if (!dir.startsWith(baseDir)) return ''
  let relativePath = dir.slice(baseDir.length)
  if (platform === 'win32') {
    // Windows path separators are backslashes — normalize so the strip/split below
    // works. Gated on win32 so a legitimate POSIX backslash isn't mangled.
    relativePath = relativePath.replace(/\\/g, '/')
  }
  relativePath = relativePath.replace(/^\//, '')
  return relativePath ? relativePath.split('/').join(':') : ''
}
