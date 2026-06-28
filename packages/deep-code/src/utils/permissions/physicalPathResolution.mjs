import { dirname, isAbsolute, join, parse } from 'path'

/**
 * True when `path` contains a `..` PATH SEGMENT (parent traversal), as opposed
 * to `..` inside a filename (`a..b`, `..foo`, `foo..`). Used to gate the
 * (more expensive) physical resolution below — paths without a `..` segment are
 * resolved correctly by the existing lexical path.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function hasParentTraversalSegment(path) {
  return /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(path)
}

/**
 * Resolve where a path with a `..` segment ACTUALLY lands, the way the OS
 * (and bash's open()) does — resolving symlinks PHYSICALLY before applying
 * `..`, rather than collapsing `..` lexically.
 *
 * Why this is needed: `path.resolve` AND Node's `fs.realpathSync` (both the JS
 * and `.native` impls) collapse a `..` segment LEXICALLY — they delete the
 * preceding component as a STRING before following it. So for an in-cwd symlink
 * `link -> /external`, `cwd/link/../x` resolves to the in-cwd `cwd/x` in Node,
 * while the kernel follows `link` to `/external` and applies `..` to land at
 * `/external/.. = /parent-of-external/x` — OUTSIDE cwd. A permission check that
 * trusts Node's resolution validates the wrong (in-cwd) location and lets the
 * write escape. (Verified: `realpathSync('cwd/link/..') === 'cwd'` in Node, but
 * `realpath(1)` / `os.path.realpath` / the kernel give `/parent-of-external`.)
 *
 * Algorithm — walk components left to right over a PHYSICAL accumulator:
 *  - `..`  -> `dirname(resolved)` (resolved is already physical, so this is the
 *            physical parent; clamps at the filesystem root like the kernel).
 *  - other -> `resolveOneLevel(join(resolved, part))`: realpath the candidate,
 *            which has NO `..` (we handle those ourselves), so Node's realpath
 *            follows its symlink CORRECTLY. Once a component does not exist
 *            (isCanonical=false), the tail can contain no symlinks, so the rest
 *            is appended lexically.
 *
 * `resolveOneLevel(p)` is injected (a thin wrapper over safeResolvePath) so this
 * stays pure and node-testable. It must return `{ resolvedPath, isCanonical }`
 * where isCanonical=true iff `p` was realpath-resolved (exists), matching
 * safeResolvePath's contract.
 *
 * NOTE: a symlink whose TARGET itself contains a `..` (e.g. `link -> ../x`) is
 * still resolved by Node's realpath inside resolveOneLevel and so inherits
 * Node's lexical-`..` handling for that target — a narrower, pre-existing edge
 * not addressed here. This closes the common case: a `..` in the INPUT path
 * after a symlink component.
 *
 * @param {string} physicalCwd  the symlink-resolved cwd (start dir for relative paths)
 * @param {string} cleanPath  the (de-quoted, tilde-expanded) input path
 * @param {(candidate: string) => { resolvedPath: string, isCanonical: boolean }} resolveOneLevel
 * @returns {string} the absolute physical landing path
 */
export function resolvePhysicalLanding(physicalCwd, cleanPath, resolveOneLevel) {
  let resolved
  let parts
  if (isAbsolute(cleanPath)) {
    const root = parse(cleanPath).root
    resolved = root
    parts = cleanPath.slice(root.length).split(/[/\\]+/)
  } else {
    resolved = physicalCwd
    parts = cleanPath.split(/[/\\]+/)
  }

  let existing = true
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      resolved = dirname(resolved)
      continue
    }
    const candidate = join(resolved, part)
    if (existing) {
      const { resolvedPath, isCanonical } = resolveOneLevel(candidate)
      if (isCanonical) {
        resolved = resolvedPath
      } else {
        existing = false
        resolved = candidate
      }
    } else {
      resolved = candidate
    }
  }
  return resolved
}
