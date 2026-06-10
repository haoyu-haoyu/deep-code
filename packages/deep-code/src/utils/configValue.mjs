// Small coercion helpers for reading config/env values that fall back to a default.
// The bare `?? default` / `Number(...)` idioms let a present-but-EMPTY or non-numeric value
// slip through (an empty string is not nullish; `Number('') === 0`, `Number('x') === NaN`),
// which then reaches the request as a broken `model: ''` or `max_tokens: 0/NaN`. These treat
// empty/whitespace/garbage as ABSENT so the default applies — while staying byte-identical
// for the normal cases (a real non-empty string, a positive-integer count, and the
// all-unset default path that the DeepSeek cache prefix depends on).

// First value that is "really present": skips undefined/null and an empty-or-whitespace-only
// string; any other value (incl. a non-string) passes through, so it is identical to a
// `a ?? b ?? c` chain except that an empty string is treated as absent.
export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    return value
  }
  return undefined
}

// Coerce to a positive integer, else return the fallback. `Number(value)` is used (so a
// numeric string like '512' works), but a non-integer / non-positive / NaN result (from '',
// 'lots', '0', '-5', '3.5') yields the fallback instead of a broken token count.
export function parsePositiveIntOr(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
