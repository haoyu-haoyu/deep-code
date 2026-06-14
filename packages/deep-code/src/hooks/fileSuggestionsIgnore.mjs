// Filter repoRoot-relative git paths through an `ignore` instance, guarding the
// one input shape the library rejects.
//
// `git ls-files` (run with cwd=repoRoot) emits clean repoRoot-relative paths,
// and .ignore/.rgignore patterns are anchored at repoRoot, so the ignore filter
// MUST run on these RAW paths — never on the cwd-relative form. When DeepCode is
// launched from a subdirectory of the repo (the normal monorepo case), making a
// path cwd-relative turns every file outside the subdir into a '../'-prefixed
// path, and the `ignore` library throws a RangeError on those ("path should be a
// `path.relative()`d string"). Filtering the cwd-relative list therefore crashed
// the git fast path, which then fell back to a ripgrep scan of only the current
// subdir — silently dropping every file outside it from @-mention suggestions.
//
// The try/catch is belt-and-suspenders: even if a bad path ever reaches here,
// never disable the git fast path by throwing — return the list unfiltered.
export function filterIgnoredGitPaths(rawRepoRelativeFiles, ig) {
  if (!ig) return rawRepoRelativeFiles
  try {
    return ig.filter(rawRepoRelativeFiles)
  } catch {
    return rawRepoRelativeFiles
  }
}
