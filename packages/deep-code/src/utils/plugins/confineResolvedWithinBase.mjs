import { isSymlinkTargetContained } from './symlinkContainment.mjs'

// Read-time symlink-containment guard for plugin file reads.
//
// #601 stopped copyDir (the INSTALL copy) from materializing an out-of-tree
// symlink in the versioned cache. But the cache-only startup loader
// (loadPluginFromMarketplaceEntryCacheOnly), the copy-fail fallback, and the
// env-gated zip collector read plugin files IN PLACE from a (possibly git-cloned,
// attacker-authored) dir WITHOUT copyDir. There, the manifest-declared
// commandsPaths / agentsPaths / .mcp.json reads use fs.stat + fs.readFile, which
// FOLLOW a symlink, and the only guard is the LEXICAL (symlink-blind)
// validatePathWithinBase — so a plugin file that is a symlink to
// `<home>/.ssh/id_rsa` is read into the model context. This is the read-time
// realpath check that closes those paths.
//
// `resolveFn(path)` returns the path with all symlinks resolved (canonical), or
// the original path on error/non-existence — the contract of safeResolvePath()'s
// resolvedPath, which the .ts callers pass (it is FIFO/socket/device-safe, so a
// malicious plugin can't hang realpath). Both base and candidate are resolved so a
// symlinked plugin root is handled. Returns true iff the resolved candidate stays
// within the resolved base.
//
// Pure value-in/value-out (the leaf math reuses isSymlinkTargetContained; fs lives
// behind the injected resolveFn) so it is node-testable.
//
// @param {(p: string) => string} resolveFn
// @param {string} base
// @param {string} candidate
// @returns {boolean}
export function confineResolvedWithinBase(resolveFn, base, candidate) {
  let resolvedBase, resolvedCandidate
  try {
    resolvedBase = resolveFn(base)
    resolvedCandidate = resolveFn(candidate)
  } catch {
    return false
  }
  return isSymlinkTargetContained(resolvedCandidate, resolvedBase)
}
