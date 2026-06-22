/**
 * Split a GrepTool `glob` input into individual ripgrep `--glob` patterns.
 *
 * Tokens are separated by whitespace OR by a comma at brace depth 0. A comma
 * INSIDE a `{...}` alternation is part of the glob and is kept.
 *
 * The previous split kept any token containing both `{` and `}` whole, so a
 * mixed token like `*.{ts,tsx},*.js` reached ripgrep as ONE glob — ripgrep
 * treats the comma outside the braces as literal text, so it matched nothing and
 * the `*.js` filter was silently dropped. Depth-aware splitting yields
 * `['*.{ts,tsx}', '*.js']`, while pure-comma (`*.js,*.ts`) and pure-brace
 * (`*.{ts,tsx}`) inputs split exactly as before.
 *
 * Brace depth never goes below 0 (an unmatched `}` is treated as a literal), so
 * a stray closing brace behaves like the old comma split rather than throwing.
 *
 * @param {string} glob  the raw `glob` input (may contain spaces)
 * @returns {string[]}   individual glob patterns (empty segments dropped)
 */
export function splitGlobPatterns(glob) {
  const patterns = []
  for (const token of String(glob ?? '').split(/\s+/)) {
    if (!token) continue
    let depth = 0
    let current = ''
    for (const ch of token) {
      if (ch === '{') {
        depth += 1
        current += ch
      } else if (ch === '}') {
        if (depth > 0) depth -= 1
        current += ch
      } else if (ch === ',' && depth === 0) {
        if (current) patterns.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    if (current) patterns.push(current)
  }
  return patterns
}
