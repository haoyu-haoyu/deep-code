/**
 * Decide whether to emit ANSI color on a native-path stream, honoring the
 * NO_COLOR convention (https://no-color.org): any non-empty NO_COLOR suppresses
 * color even on a TTY. DEEPCODE_FORCE_COLOR=1 forces it on regardless (an
 * explicit override wins over NO_COLOR, matching the FORCE_COLOR precedence the
 * Ink/chalk surface already uses). Otherwise color follows the stream's TTY-ness
 * so piped/redirected output stays plain.
 *
 * The native single-turn/compact path (welcome banner, spinner, tool-use line,
 * slash palette, model picker) emits hardcoded truecolor SGR directly, so —
 * unlike the chalk-based TUI — it must apply this gate itself.
 *
 * @param {{ isTTY?: boolean } | undefined} stream - the output stream (stdout/stderr)
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function shouldUseColor(stream, env = process.env) {
  if (env.DEEPCODE_FORCE_COLOR === '1') return true
  if (env.NO_COLOR) return false
  return Boolean(stream?.isTTY)
}
