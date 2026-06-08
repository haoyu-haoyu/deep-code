// Deterministic, locale-INDEPENDENT string ordering (UTF-16 code-unit comparison).
//
// Any sort whose output rides the DeepSeek BYTE-IDENTICAL cached prefix MUST use this,
// NOT String.prototype.localeCompare(). localeCompare depends on the runtime's default
// locale + ICU build, so identically-named entries can sort differently across machines
// or environments — silently breaking the prefix cache (DeepCode's ~93%-hit moat). The
// request builders sort the tool/skill manifests right before they enter the cached
// prefix, so a cross-locale reorder there is a real cache-collapse hole.
//
// A plain code-unit compare (`<` / `>`) is total, antisymmetric, transitive, never throws,
// and produces the same order on every platform — exactly what a cache key needs. (Bare
// `Array.prototype.sort()` with no comparator is already code-unit, so only EXPLICIT
// comparators need this.)
export function byteCompare(a, b) {
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}
