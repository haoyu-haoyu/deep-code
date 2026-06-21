import { sep } from 'node:path'

// Is a symlink's REALPATH-resolved target inside the source tree being copied?
//
// copyDir (pluginLoader.ts) is the install-copy for every plugin source
// (local / npm / git-subdir / marketplace → versioned cache). For a symlink
// ENTRY it previously re-created an OUT-OF-TREE target verbatim as a live
// absolute symlink in the cache. The manifest-declared commandsPaths /
// agentsPaths loaders and the .mcp.json loader read those paths with
// fs.stat + fs.readFile, which FOLLOW a symlink — so a commands-only plugin
// shipping `evil → <home>/.ssh/id_rsa` turned into an arbitrary host-file read
// into the model context. The two existing guards are blind to it:
// validatePathWithinBase and the #591 relPathWithinBase refine are both LEXICAL
// (string-level), so a real on-disk symlink slips past them.
//
// This is the realpath-level containment check copyDir needs: re-create only a
// symlink whose resolved target stays within the source tree; an out-of-tree
// (or unresolvable/broken) target is skipped, so it never reaches the cache for
// a loader to follow. Mirrors the in-tree containment math already in copyDir.
//
// Pure value-in/value-out so it is node-testable (pluginLoader.ts is bun-tainted).
//
// @param {string} resolvedTarget - realpath() of the symlink
// @param {string} resolvedSrc - realpath() of the source root being copied
// @returns {boolean}
export function isSymlinkTargetContained(resolvedTarget, resolvedSrc) {
  if (typeof resolvedTarget !== 'string' || typeof resolvedSrc !== 'string') {
    return false
  }
  if (resolvedSrc.length === 0) return false
  const srcPrefix = resolvedSrc.endsWith(sep) ? resolvedSrc : resolvedSrc + sep
  return resolvedTarget === resolvedSrc || resolvedTarget.startsWith(srcPrefix)
}
