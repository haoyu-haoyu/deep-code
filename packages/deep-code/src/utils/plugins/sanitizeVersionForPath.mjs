/**
 * Sanitize a plugin version string for use as a single path segment in the
 * versioned cache path `…/cache/{marketplace}/{plugin}/{version}/`.
 *
 * The marketplace and plugin segments forbid dots entirely (their sanitizer is
 * `/[^a-zA-Z0-9\-_]/g`), so they can never form a traversal token. Version must
 * keep dots for semver (e.g. `1.2.3`), which reopened the hole: a version that
 * is exactly `".."` survives the dot-allowing sanitizer and, because
 * `path.join(base, …, plugin, "..")` normalizes the `..` away, the cache path
 * escapes UP to the marketplace directory — corrupting the marketplace cache or
 * making the plugin load from the marketplace root. The `version` field is only
 * `z.string().optional()` (no semver schema), so a malicious marketplace.json /
 * plugin manifest can set it freely.
 *
 * This keeps the original char-class sanitize (slashes and other unsafe chars
 * become `-`, so a multi-segment `../../x` collapses to one harmless name
 * `..-..-x`) and additionally neutralizes the two remaining traversal vectors:
 * a segment that is ONLY dots, and an empty result (which path.join would drop,
 * silently un-versioning the cache).
 *
 * @param {string} version
 * @returns {string} a safe single path segment (never `.`, `..`, or empty)
 */
export function sanitizeVersionForPath(version) {
  let s = String(version ?? '').replace(/[^a-zA-Z0-9\-_.]/g, '-')
  // A pure-dot segment ("." / ".." / "...") is the only path.join traversal
  // token left once slashes are already mapped to "-".
  if (/^\.+$/.test(s)) s = '-'
  // An empty segment collapses in path.join (no version subdir) — keep a token.
  if (s === '') s = '-'
  return s
}
