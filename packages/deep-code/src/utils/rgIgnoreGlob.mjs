// Build a ripgrep `--glob` argument that EXCLUDES a Read-deny ignore pattern.
//
// ripgrep anchors a relative glob that contains a slash at the SEARCH ROOT, so
// the glob `config/x` matches only `./config/x`, NOT `sub/config/x`. A Read-deny
// rule has to hide the file at every depth, so a non-rooted pattern is prefixed
// with a leading `**` + separator (double-star) glob to match anywhere; a rooted
// pattern — already `/`-anchored by normalizePatternToPath -> prependDirSep — is
// kept anchored as-is.
//
// All three consumers of normalizePatternsToPath() output — GlobTool
// (utils/glob.ts), GrepTool, and the rounded telemetry file count
// (ripgrep.ts countFilesRoundedRg) — MUST build the exclusion glob identically.
// This is the single shared rule (GrepTool previously inlined it; GlobTool and
// the telemetry count emitted `!${pattern}` verbatim and so failed to exclude
// nested copies of a deny-protected file — GlobTool leaked their paths into
// results, the count slightly over-counted).
//
// See https://github.com/BurntSushi/ripgrep/discussions/2156#discussioncomment-2316335
//
// @param {string} pattern  a pattern from normalizePatternsToPath (rooted => leading '/')
// @returns {string}        the negated ripgrep glob, e.g. `!/config/x` (rooted)
//                          or `!**/config/x` (relative, matches at any depth)
export function rgIgnoreGlob(pattern) {
  return pattern.startsWith('/') ? `!${pattern}` : `!**/${pattern}`
}
