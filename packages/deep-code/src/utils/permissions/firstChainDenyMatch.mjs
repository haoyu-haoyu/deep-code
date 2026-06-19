// Walk a resolved symlink chain (the original input path -> each intermediate
// readlink target -> the final realpath, in the order getPathsForPermissionCheck
// returns them) and return the FIRST path a deny rule matches, or null.
//
// This encodes the invariant that a deny rule must cover the WHOLE chain (first
// match wins) — the same loop the file tools already inline in
// checkReadPermissionForTool / checkWritePermissionForTool. The Bash/PowerShell path
// validator historically checked only the FINAL realpath (validatePath's canonical
// shortcut), so a deny rule written against the original symlink name or an
// intermediate hop was enforced by Read but silently bypassed by Bash. Running this
// over the full chain makes the two paths consistent (additive deny coverage — it
// can only turn a currently-bypassed deny into an enforced one).
/**
 * @template R
 * @param {readonly string[]} chainPaths  the symlink chain (getPathsForPermissionCheck output)
 * @param {(path: string) => R | null | undefined} matchDeny  the matching deny rule for a path, or null
 * @returns {{ path: string, rule: R } | null}
 */
export function firstChainDenyMatch(chainPaths, matchDeny) {
  for (const path of chainPaths) {
    const rule = matchDeny(path)
    if (rule) return { path, rule }
  }
  return null
}
