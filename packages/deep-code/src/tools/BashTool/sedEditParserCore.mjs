// Pure, correctness-critical sed -i edit core, extracted from sedEditParser.ts so
// it is unit-testable under `node --test` (the .ts imports a bun-tainted shell
// parser via shellQuote for tokenization). Both functions here are pure
// (applySedSubstitution uses only crypto.randomBytes):
//   - parseSedSubstitutionExpression: split `s/pat/rep/flags` by delimiter with
//     backslash-escape tracking (a bug here mis-splits pattern vs replacement).
//   - applySedSubstitution: convert the sed BRE/ERE pattern to a JS RegExp and
//     apply it, incl. BRE<->ERE metachar escaping and random-salted `&`/`\&`
//     replacement handling (a bug here silently corrupts edited file content).
// Extracted VERBATIM (behavior-preserving); sedEditParser.ts imports them back.

import { randomBytes } from 'crypto'
import vm from 'node:vm'

// Hard timeout for the substitution. applySedSubstitution renders the diff preview
// SYNCHRONOUSLY in the permission dialog's single-threaded Ink render path over a
// MODEL-supplied pattern, so a catastrophic-backtracking (ReDoS) pattern would otherwise
// hang the UI indefinitely — before the user can even deny. The budget bounds that.
//
// A timeout returns the content UNCHANGED, and on timeout the caller
// (SedEditPermissionRequest) sees the no-change result and falls back to running the REAL
// shell `sed -i` — so a timed-out edit is NEVER silently dropped. That fallback is what makes
// "return unchanged" safe here even though the budget is reachable not only by pathological
// patterns but also, in principle, by a legitimate-but-heavy linear replace on a very large
// file: such an edit still applies for real (via shell sed, in an interruptible subprocess),
// while the synchronous UI preview stays bounded. (A file-SIZE cap was NOT safe because it
// short-circuited the same path with the unchanged content and no real-sed fallback.) 2 s is
// generous for the preview — a typical replace finishes in well under 100 ms even at 10 MB.
const SED_SUBSTITUTION_TIMEOUT_MS = 2000

// BRE→ERE conversion placeholders (null-byte sentinels, never appear in user input)
const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00'
const PLUS_PLACEHOLDER = '\x00PLUS\x00'
const QUESTION_PLACEHOLDER = '\x00QUESTION\x00'
const PIPE_PLACEHOLDER = '\x00PIPE\x00'
const LPAREN_PLACEHOLDER = '\x00LPAREN\x00'
const RPAREN_PLACEHOLDER = '\x00RPAREN\x00'
const BACKSLASH_PLACEHOLDER_RE = new RegExp(BACKSLASH_PLACEHOLDER, 'g')
const PLUS_PLACEHOLDER_RE = new RegExp(PLUS_PLACEHOLDER, 'g')
const QUESTION_PLACEHOLDER_RE = new RegExp(QUESTION_PLACEHOLDER, 'g')
const PIPE_PLACEHOLDER_RE = new RegExp(PIPE_PLACEHOLDER, 'g')
const LPAREN_PLACEHOLDER_RE = new RegExp(LPAREN_PLACEHOLDER, 'g')
const RPAREN_PLACEHOLDER_RE = new RegExp(RPAREN_PLACEHOLDER, 'g')

/**
 * Parse a sed `s/pattern/replacement/flags` expression (only `/` delimiter).
 * Returns {pattern, replacement, flags} or null if malformed / unsafe flags.
 * @param {string} expression
 */
export function parseSedSubstitutionExpression(expression) {
  const substMatch = expression.match(/^s\//)
  if (!substMatch) {
    return null
  }

  const rest = expression.slice(2) // Skip 's/'

  // Find pattern and replacement by tracking escaped characters
  let pattern = ''
  let replacement = ''
  let flags = ''
  let state = 'pattern'
  let j = 0

  while (j < rest.length) {
    const char = rest[j]

    if (char === '\\' && j + 1 < rest.length) {
      // Escaped character
      if (state === 'pattern') {
        pattern += char + rest[j + 1]
      } else if (state === 'replacement') {
        replacement += char + rest[j + 1]
      } else {
        flags += char + rest[j + 1]
      }
      j += 2
      continue
    }

    if (char === '/') {
      if (state === 'pattern') {
        state = 'replacement'
      } else if (state === 'replacement') {
        state = 'flags'
      } else {
        // Extra delimiter in flags - unexpected
        return null
      }
      j++
      continue
    }

    if (state === 'pattern') {
      pattern += char
    } else if (state === 'replacement') {
      replacement += char
    } else {
      flags += char
    }
    j++
  }

  // Must have found all three parts (pattern, replacement delimiter, and optional flags)
  if (state !== 'flags') {
    return null
  }

  // Validate flags - only allow safe substitution flags
  const validFlags = /^[gpimIM1-9]*$/
  if (!validFlags.test(flags)) {
    return null
  }
  return { pattern, replacement, flags }
}

/**
 * Apply a sed substitution to file content
 * Returns the new content after applying the substitution
 */
export function applySedSubstitution(
  content,
  sedInfo,
  { timeoutMs = SED_SUBSTITUTION_TIMEOUT_MS } = {},
) {
  // Convert sed pattern to JavaScript regex
  let regexFlags = ''

  // Handle global flag
  if (sedInfo.flags.includes('g')) {
    regexFlags += 'g'
  }

  // Handle case-insensitive flag (i or I in sed)
  if (sedInfo.flags.includes('i') || sedInfo.flags.includes('I')) {
    regexFlags += 'i'
  }

  // Handle multiline flag (m or M in sed)
  if (sedInfo.flags.includes('m') || sedInfo.flags.includes('M')) {
    regexFlags += 'm'
  }

  // Convert sed pattern to JavaScript regex pattern
  let jsPattern = sedInfo.pattern
    // Unescape \/ to /
    .replace(/\\\//g, '/')

  // In BRE mode (no -E flag), metacharacters have opposite escaping:
  // BRE: \+ means "one or more", + is literal
  // ERE/JS: + means "one or more", \+ is literal
  // We need to convert BRE escaping to ERE for JavaScript regex
  if (!sedInfo.extendedRegex) {
    jsPattern = jsPattern
      // Step 1: Protect literal backslashes (\\) first - in both BRE and ERE, \\ is literal backslash
      .replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
      // Step 2: Replace escaped metacharacters with placeholders (these should become unescaped in JS)
      .replace(/\\\+/g, PLUS_PLACEHOLDER)
      .replace(/\\\?/g, QUESTION_PLACEHOLDER)
      .replace(/\\\|/g, PIPE_PLACEHOLDER)
      .replace(/\\\(/g, LPAREN_PLACEHOLDER)
      .replace(/\\\)/g, RPAREN_PLACEHOLDER)
      // Step 3: Escape unescaped metacharacters (these are literal in BRE)
      .replace(/\+/g, '\\+')
      .replace(/\?/g, '\\?')
      .replace(/\|/g, '\\|')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      // Step 4: Replace placeholders with their JS equivalents
      .replace(BACKSLASH_PLACEHOLDER_RE, '\\\\')
      .replace(PLUS_PLACEHOLDER_RE, '+')
      .replace(QUESTION_PLACEHOLDER_RE, '?')
      .replace(PIPE_PLACEHOLDER_RE, '|')
      .replace(LPAREN_PLACEHOLDER_RE, '(')
      .replace(RPAREN_PLACEHOLDER_RE, ')')
  }

  // Unescape sed-specific escapes in replacement
  // Convert \n to newline, & to $& (match), etc.
  // Use a unique placeholder with random salt to prevent injection attacks
  const salt = randomBytes(8).toString('hex')
  const ESCAPED_AMP_PLACEHOLDER = `___ESCAPED_AMPERSAND_${salt}___`
  const jsReplacement = sedInfo.replacement
    // Unescape \/ to /
    .replace(/\\\//g, '/')
    // First escape \& to a placeholder
    .replace(/\\&/g, ESCAPED_AMP_PLACEHOLDER)
    // Convert & to $& (full match) - use $$& to get literal $& in output
    .replace(/&/g, '$$&')
    // Convert placeholder back to literal &
    .replace(new RegExp(ESCAPED_AMP_PLACEHOLDER, 'g'), '&')

  let regex
  try {
    regex = new RegExp(jsPattern, regexFlags)
  } catch {
    // Invalid regex → no edit applies → original content unchanged.
    return content
  }

  // Run the replace under a hard timeout (see SED_SUBSTITUTION_TIMEOUT_MS). node:vm's
  // timeout is the only synchronous way to interrupt an otherwise-uninterruptible
  // String.replace; it aborts a backtracking regex. A timeout is treated as not-applied
  // (original content returned) rather than hanging the UI forever; the caller then falls
  // back to the real shell `sed -i` so no edit is silently lost (see the note above).
  try {
    const context = vm.createContext({ content, regex, jsReplacement })
    return vm.runInContext('content.replace(regex, jsReplacement)', context, {
      timeout: timeoutMs,
    })
  } catch {
    return content
  }
}
