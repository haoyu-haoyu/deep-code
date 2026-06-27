/**
 * Parse a boolean frontmatter value, normalizing surrounding whitespace and
 * case for the string form.
 *
 * A real YAML boolean is returned as-is. A string is accepted only when it
 * trims and lower-cases to "true". Anything else (numbers, arrays, objects,
 * null) is false — matching the prior strict semantics, which only ever
 * returned true for the literal `true` or the string `"true"`.
 *
 * The whitespace/case normalization closes a FAIL-OPEN gap: a skill/command
 * frontmatter like `disable-model-invocation: " true "` or
 * `disable-model-invocation: True` is preserved by the YAML parser as the
 * string `" true "` / `"True"`, which the old `=== 'true'` check rejected — so
 * a restriction the author clearly intended (`true`) silently DID NOT APPLY and
 * the skill stayed model-invocable. The sibling frontmatter parsers already
 * normalize this way (`parseShellFrontmatter` does
 * `String(value).trim().toLowerCase()`); the boolean parser was the lone
 * outlier. Normalizing only ever flips a `true`-variant from false to true, so
 * it can only make an author-declared value apply, never invert a `false`.
 *
 * @param {unknown} value  the raw frontmatter value (boolean, string, or other)
 * @returns {boolean}
 */
export function normalizeBooleanFrontmatter(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}
