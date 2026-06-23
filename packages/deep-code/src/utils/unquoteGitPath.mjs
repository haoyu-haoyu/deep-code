/**
 * Decode a git "C-quoted" path back to its real bytes.
 *
 * git wraps a path in double quotes and C-style-escapes it whenever the name
 * contains a double-quote, backslash, tab, newline (or, with the default
 * core.quotepath=true, a non-ASCII byte). `core.quotepath=false` (passed by
 * gitDiffArgs) makes non-ASCII raw, but it does NOT stop the quoting of a
 * `"`/`\`/tab/newline — so a path like `has"quote.txt` still arrives as the
 * literal string `"has\"quote.txt"`. Both the diff header parser and the numstat
 * parser must decode it to the SAME canonical path or the per-file stats and the
 * hunks fail to join (the file shows up as an un-expandable entry).
 *
 * Decodes the standard git escapes (\" \\ \t \n \r \a \b \f \v and \NNN octal,
 * the octal bytes reassembled and UTF-8 decoded). A string that is not a quoted
 * path is returned unchanged.
 *
 * @param {string} raw
 * @returns {string}
 */
export function unquoteGitPath(raw) {
  if (
    typeof raw !== 'string' ||
    raw.length < 2 ||
    raw[0] !== '"' ||
    raw[raw.length - 1] !== '"'
  ) {
    return raw
  }

  const body = raw.slice(1, -1)
  /** @type {number[]} */
  const bytes = []
  const SIMPLE = { '"': 0x22, '\\': 0x5c, t: 0x09, n: 0x0a, r: 0x0d, a: 0x07, b: 0x08, f: 0x0c, v: 0x0b }

  let i = 0
  while (i < body.length) {
    if (body[i] === '\\' && i + 1 < body.length) {
      const next = body[i + 1]
      if (next >= '0' && next <= '7') {
        // Octal escape: up to 3 octal digits -> one raw byte.
        let oct = ''
        let j = i + 1
        while (j < body.length && oct.length < 3 && body[j] >= '0' && body[j] <= '7') {
          oct += body[j]
          j += 1
        }
        bytes.push(parseInt(oct, 8) & 0xff)
        i = j
        continue
      }
      if (Object.prototype.hasOwnProperty.call(SIMPLE, next)) {
        bytes.push(SIMPLE[next])
        i += 2
        continue
      }
      // Unknown escape — keep the escaped character literally.
      const cp = body.codePointAt(i + 1) ?? 0
      pushUtf8(bytes, cp)
      i += 1 + (cp > 0xffff ? 2 : 1)
      continue
    }
    // Raw character (ASCII, or raw non-ASCII under core.quotepath=false).
    const cp = body.codePointAt(i) ?? 0
    pushUtf8(bytes, cp)
    i += cp > 0xffff ? 2 : 1
  }

  return Buffer.from(bytes).toString('utf8')
}

/**
 * @param {number[]} bytes
 * @param {number} codePoint
 */
function pushUtf8(bytes, codePoint) {
  for (const b of Buffer.from(String.fromCodePoint(codePoint), 'utf8')) {
    bytes.push(b)
  }
}
