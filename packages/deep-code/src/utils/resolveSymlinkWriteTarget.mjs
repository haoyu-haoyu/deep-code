// Resolve the path an atomic write should actually land on when the file being
// written is reached through a symlink chain.
//
// writeFileSyncAndFlush_DEPRECATED writes to a sibling temp file and renames it
// over the target. A rename REPLACES whatever entry is at the target path — so
// if it renamed over the symlink itself, the symlink would become a regular
// file. To preserve the link, the writer resolves the symlink to its target and
// renames over THAT instead.
//
// The bug: it resolved only ONE hop (a single readlink). For a multi-hop chain
// (top -> mid -> real, common with dotfile managers / stow / home-manager that
// build symlink farms) the write landed on `mid`, the INTERMEDIATE link:
//   - `mid` was replaced by a regular file holding the new content,
//   - the canonical `real` was left untouched with the OLD content,
//   - `mid`'s symlink was destroyed.
// Meanwhile the READ path follows the WHOLE chain (the OS, and realpathSync, go
// all the way to `real`), so the model matched old_string against `real`'s
// content but the edit never reached `real`: a SILENT FORK. Reading through
// `top` shows the edit; reading the canonical file (or any other alias) shows
// the stale original, and one link in the chain is gone.
//
// Fix: follow EVERY hop to the chain's end — the first entry that is not a
// symlink (the canonical regular file) or the first non-existent target (a
// dangling link, whose target we then create). Renaming over that final target
// updates the real file and preserves every symlink in the chain.
//
// `readLinkHop(p)` returns the ABSOLUTE path `p` points to for one hop, or null
// when `p` is not a symlink / does not exist / is unreadable (i.e. `p` itself is
// the write target). Resolution of relative link targets lives in the caller's
// hop so each hop resolves relative to its own directory; this leaf is just the
// pure walk, with cycle and depth guards so a self-referential link can't spin.
//
// @param {string} startPath              the path handed to the writer
// @param {(p: string) => string | null} readLinkHop  one-hop resolver (see above)
// @returns {string} the final path to write/rename over
export function resolveSymlinkWriteTarget(startPath, readLinkHop) {
  let current = startPath
  const visited = new Set([current])
  // Matches SYMLOOP_MAX / the chain-walk cap in getPathsForPermissionCheck.
  const MAX_HOPS = 40
  for (let i = 0; i < MAX_HOPS; i++) {
    const next = readLinkHop(current)
    if (next === null) break // current is not a symlink → it is the write target
    if (visited.has(next)) break // cycle → stop at the last resolvable entry
    visited.add(next)
    current = next
  }
  return current
}
