// Does a plugin/marketplace manifest RELATIVE path stay within its base directory
// (no traversal)?
//
// The RelativePath schema only required `.startsWith('./')`, which PERMITS
// './../../../home/<user>/.ssh/id_rsa' — the leading './' is satisfied while a '..'
// segment walks straight out of the plugin/marketplace dir. Those paths are then
// raw-join()'d and READ as command/skill/hook bodies into the model context (an
// out-of-tree host-file disclosure beyond what a commands-only plugin was trusted
// to do), and the marketplace `entry.source` resolves the plugin ROOT. The project
// already enforces containment at INSTALL time (validatePathWithinBase) but omitted
// it at the load/component-resolution sinks, and the schema NAME ("RelativePath")
// reads like a containment guarantee it did not provide.
//
// This is the lexical PARSE-time predicate that makes the schema name real: it
// rejects any '..' path segment (the traversal vector) so a malicious manifest /
// marketplace.json is rejected at validation, closing every consumer that parses
// through the schema at once. Splits on BOTH '/' and '\\' so a backslash segment
// can't smuggle a '..'. (Absolute paths are already excluded by the schema's
// startsWith('./'); the resolve-time validatePathWithinBase guard is the complementary
// runtime check for any path that bypasses the schema, e.g. a re-read mutable source.)
//
// Pure value-in/value-out so it is node-testable (schemas.ts is bun-tainted).
export function relPathWithinBase(relPath) {
  if (typeof relPath !== 'string') return false
  if (relPath.includes('\0')) return false
  return !relPath.split(/[/\\]/).some(segment => segment === '..')
}
