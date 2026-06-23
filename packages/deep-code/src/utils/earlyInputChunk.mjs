/**
 * Pure core of early-input capture (the logic that decides what a chunk of raw
 * terminal bytes contributes to the pre-REPL prompt buffer). Extracted so the
 * escape-sequence handling is node-testable; the .ts wrapper keeps the stdin
 * plumbing and acts on the returned control signal.
 *
 * @param {number} i  index of the ESC (0x1B) byte
 * @returns {number} index just past the full escape sequence
 */
export function skipEscapeSequence(str, i) {
  i++ // past ESC
  const introducer = str[i]
  if (i < str.length && (introducer === '[' || introducer === 'O')) {
    // CSI (ESC '[') or SS3 (ESC 'O'). The introducer byte ('[' = 0x5B, 'O' =
    // 0x4F) is itself in the 0x40-0x7E "final byte" range, so a naive
    // scan-to-first-0x40-0x7E stops AT the introducer and leaks the parameter +
    // final bytes (arrow keys leaked as letters; a bracketed-paste ESC[200~
    // leaked "200~..."). Consume the introducer, then the parameter/intermediate
    // bytes (0x20-0x3F), then the single final byte (0x40-0x7E).
    i++ // past the introducer
    while (i < str.length && str.charCodeAt(i) >= 0x20 && str.charCodeAt(i) <= 0x3f) {
      i++
    }
    if (i < str.length) i++ // the final byte
  } else {
    // Other ESC sequences (Alt+key, etc.): skip to the first 0x40-0x7E byte.
    while (
      i < str.length &&
      !(str.charCodeAt(i) >= 64 && str.charCodeAt(i) <= 126)
    ) {
      i++
    }
    if (i < str.length) i++ // the terminating byte
  }
  return i
}

/**
 * Fold a chunk of raw terminal input into the early-input buffer.
 *
 * @param {string} buffer        the buffer accumulated so far
 * @param {string} str           the new raw chunk
 * @param {(s: string) => string} lastGrapheme  returns the last grapheme cluster
 *        of a string (injected: the real impl lives in a .ts module)
 * @returns {{ buffer: string, control: 'sigint' | 'eof' | null }}
 *        the updated buffer and any control signal (Ctrl+C / Ctrl+D) that should
 *        stop capture; processing stops at the control byte, matching the
 *        previous early-return behavior.
 */
export function processEarlyInputChunk(buffer, str, lastGrapheme) {
  let i = 0
  while (i < str.length) {
    const code = str.charCodeAt(i)

    // Ctrl+C — stop and signal SIGINT.
    if (code === 3) {
      return { buffer, control: 'sigint' }
    }
    // Ctrl+D — EOF, stop capturing.
    if (code === 4) {
      return { buffer, control: 'eof' }
    }
    // Backspace — remove the last grapheme cluster.
    if (code === 127 || code === 8) {
      if (buffer.length > 0) {
        const last = lastGrapheme(buffer)
        buffer = buffer.slice(0, -(last.length || 1))
      }
      i++
      continue
    }
    // Escape sequences (arrow/function keys, focus events, bracketed paste).
    if (code === 27) {
      i = skipEscapeSequence(str, i)
      continue
    }
    // Other control characters (except tab, LF, CR).
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      i++
      continue
    }
    // Carriage return becomes a newline.
    if (code === 13) {
      buffer += '\n'
      i++
      continue
    }
    // Printable characters and the allowed control chars (tab, LF).
    buffer += str[i]
    i++
  }
  return { buffer, control: null }
}
