import { basename, dirname, isAbsolute, sep } from 'path'

// Extract the static base directory from a glob pattern: everything before the
// first glob special character (* ? [ {). Returns the directory portion and the
// remaining relative pattern. Moved verbatim from glob.ts; getPlatform() is now a
// `platform` PARAMETER so this stays a pure, project-dependency-free, node-testable
// leaf (the only behavioral seam was the Windows drive-root normalization).
/**
 * @param {string} pattern
 * @param {string} platform  the value of getPlatform() ('windows' | 'mac' | 'linux' | ...)
 * @returns {{ baseDir: string, relativePattern: string }}
 */
export function extractGlobBaseDirectory(pattern, platform) {
  // Find the first glob special character: *, ?, [, {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    // No glob characters - this is a literal path
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  // Get everything before the first glob character
  const staticPrefix = pattern.slice(0, match.index)

  // Find the last path separator in the static prefix
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    // No path separator before the glob - pattern is relative to cwd
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  // Root directory patterns (e.g. /*.txt): lastSepIndex 0 → baseDir '' → use '/'.
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  // Windows drive root (C:/*.txt): 'C:' is "cwd on drive C" (relative), need 'C:/'.
  if (platform === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

// The directory glob() will ACTUALLY search for `pattern` given the caller's `cwd`.
// For an absolute pattern, ripgrep is re-rooted at the pattern's static base dir —
// which can be ANYWHERE on disk — fully overriding cwd. That base dir, not the
// (cwd-defaulting) `path` field, is what the read-permission gate must validate, so
// GlobTool.getPath routes through here and glob() re-derives the same value
// (idempotent). Uses BARE isAbsolute (platform-default, matching glob.ts today) so a
// drive-letter pattern like 'C:/x' stays relative on a POSIX host exactly as before.
/**
 * @param {string} pattern
 * @param {string} cwd
 * @param {string} platform
 * @returns {string}
 */
export function resolveGlobSearchDir(pattern, cwd, platform) {
  if (isAbsolute(pattern)) {
    const { baseDir } = extractGlobBaseDirectory(pattern, platform)
    if (baseDir) return baseDir
  }
  return cwd
}
