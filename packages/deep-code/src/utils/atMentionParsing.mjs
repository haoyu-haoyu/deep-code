// @-mention extraction (file paths and MCP resources), split out so it can be
// unit tested without pulling in attachments.ts's bun:bundle import.
//
// The character set mirrors the typeahead's accepted @-mention chars
// (useTypeahead.tsx: \p{L}\p{N}\p{M} plus the path punctuation _ - . / \ ( ) [ ] ~ :)
// so the extractor accepts exactly what autocomplete suggests. The match must
// END on a Unicode WORD char (letter/number/mark/underscore) — the Unicode-aware
// equivalent of the old ASCII \b. That trims trailing prose punctuation and
// slashes ("see @config.json, then" -> "config.json", "@dir/" -> "dir") while no
// longer dropping a CJK/Unicode final char: the old /([^\s]+)\b/ only ended after
// an ASCII [A-Za-z0-9_], so "@中文" matched nothing and "@x😀"/"@a." truncated.

const PATH_CHARS = '\\p{L}\\p{N}\\p{M}_\\-./\\\\()\\[\\]~:'
const WORD_CHARS = '\\p{L}\\p{N}\\p{M}_'

// Files additionally allow '#' for the #L<start>-<end> line-range suffix.
function fileMentionRegex() {
  return new RegExp(`(^|\\s)@[${PATH_CHARS}#]*[${WORD_CHARS}]`, 'gu')
}

// MCP resources are @server:uri — require a ':' separating two path runs.
function mcpMentionRegex() {
  return new RegExp(`(^|\\s)@[${PATH_CHARS}]+:[${PATH_CHARS}]*[${WORD_CHARS}]`, 'gu')
}

function uniq(values) {
  return [...new Set(values)]
}

/**
 * Extract @-mentioned file paths, including quoted paths (@"my file.txt") and
 * the #L line-range suffix (@file.txt#L10-20). Agent mentions (@"x (agent)") are
 * skipped.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractAtMentionedFiles(content) {
  // Capture an optional #L line-range suffix AFTER the closing quote so a quoted
  // mention carries its range into parseAtMentionedFileLines like an unquoted one
  // (@"my file.txt"#L10-20 → "my file.txt#L10-20").
  const quotedAtMentionRegex = /(^|\s)@"([^"]+)"(#L\d+(?:-\d+)?)?/g
  const quotedMatches = []
  let match
  while ((match = quotedAtMentionRegex.exec(content)) !== null) {
    if (match[2] && !match[2].endsWith(' (agent)')) {
      quotedMatches.push(match[2] + (match[3] ?? ''))
    }
  }

  const regularMatches = []
  for (const full of content.match(fileMentionRegex()) || []) {
    const filename = full.slice(full.indexOf('@') + 1)
    // Quoted forms are handled above; the regular class excludes '"' so this is
    // belt-and-suspenders.
    if (!filename.startsWith('"')) {
      regularMatches.push(filename)
    }
  }

  return uniq([...quotedMatches, ...regularMatches])
}

/**
 * Extract @-mentioned MCP resources in @server:uri form.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractMcpResourceMentions(content) {
  const matches = content.match(mcpMentionRegex()) || []
  return uniq(matches.map(full => full.slice(full.indexOf('@') + 1)))
}

/**
 * Split an @-mentioned file into its path and optional #L line range:
 * "file.txt#L10-20" -> { filename, lineStart: 10, lineEnd: 20 }. A bare
 * "file.txt#L10" sets lineEnd = lineStart; a non-line-range fragment
 * ("file.txt#heading") is stripped.
 *
 * @param {string} mention
 * @returns {{ filename: string, lineStart?: number, lineEnd?: number }}
 */
export function parseAtMentionedFileLines(mention) {
  const match = mention.match(/^([^#]+)(?:#L(\d+)(?:-(\d+))?)?(?:#[^#]*)?$/)
  if (!match) {
    return { filename: mention }
  }

  const [, filename, lineStartStr, lineEndStr] = match
  let lineStart = lineStartStr ? parseInt(lineStartStr, 10) : undefined
  let lineEnd = lineEndStr ? parseInt(lineEndStr, 10) : lineStart

  // Line numbers are 1-based; clamp a 0 to line 1 so a malformed @file#L0 reads
  // line 1 rather than collapsing the downstream offset/limit to a whole-file read.
  if (lineStart !== undefined && lineStart < 1) lineStart = 1
  if (lineEnd !== undefined && lineEnd < 1) lineEnd = 1

  // Normalize an inverted range (a fat-fingered #L20-10) to lines 10-20 instead
  // of flowing a negative limit (lineEnd - lineStart + 1) downstream into a
  // silently-blank attachment. Mirrors the sibling PDF page-range path, which
  // already treats last < first as invalid.
  if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) {
    const swap = lineStart
    lineStart = lineEnd
    lineEnd = swap
  }

  return { filename: filename ?? mention, lineStart, lineEnd }
}
