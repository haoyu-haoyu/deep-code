// Pure, security-critical sed read-only-mode validation logic, extracted from
// sedValidation.ts so it is unit-testable under `node --test` (the .ts pulls in a
// bun-tainted shell parser via shellQuote/log/slowOperations and cannot load).
//
// These three functions have ZERO parser dependency:
//   - validateFlagsAgainstAllowlist: sed flag allowlist (handles combined -nE)
//   - isPrintCommand: the strict line-print allowlist (p / Np / N,Mp only)
//   - containsDangerousOperations: the defense-in-depth DENYLIST that blocks sed
//     w/W (file write) and e/E (shell exec), Unicode homoglyphs, alternate
//     delimiters, GNU step/offset addresses, comment/negation tricks, and
//     dangerous substitution/y-command flags. A gap here = a read-only-mode
//     bypass to arbitrary file write or command execution.
//
// Extracted VERBATIM (behavior-preserving); sedValidation.ts imports them back.

/**
 * Helper: Validate flags against an allowlist
 * Handles both single flags and combined flags (e.g., -nE)
 * @param flags Array of flags to validate
 * @param allowedFlags Array of allowed single-character and long flags
 * @returns true if all flags are valid, false otherwise
 */
export function validateFlagsAgainstAllowlist(
  flags,
  allowedFlags,
) {
  for (const flag of flags) {
    // Handle combined flags like -nE or -Er
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.length > 2) {
      // Check each character in combined flag
      for (let i = 1; i < flag.length; i++) {
        const singleFlag = '-' + flag[i]
        if (!allowedFlags.includes(singleFlag)) {
          return false
        }
      }
    } else {
      // Single flag or long flag
      if (!allowedFlags.includes(flag)) {
        return false
      }
    }
  }
  return true
}

/**
 * Helper: Check if a single command is a valid print command
 * STRICT ALLOWLIST - only these exact forms are allowed:
 * - p (print all)
 * - Np (print line N, where N is digits)
 * - N,Mp (print lines N through M)
 * Anything else (including w, W, e, E commands) is rejected.
 * @internal Exported for testing
 */
export function isPrintCommand(cmd) {
  if (!cmd) return false
  // Single strict regex that only matches allowed print commands
  // ^(?:\d+|\d+,\d+)?p$ matches: p, 1p, 123p, 1,5p, 10,200p
  return /^(?:\d+|\d+,\d+)?p$/.test(cmd)
}

/**
 * Check if a sed expression contains dangerous operations (denylist)
 * @param expression Single sed expression (without quotes)
 * @returns true if dangerous, false if safe
 */
export function containsDangerousOperations(expression) {
  const cmd = expression.trim()
  if (!cmd) return false

  // CONSERVATIVE REJECTIONS: Broadly reject patterns that could be dangerous
  // When in doubt, treat as unsafe

  // Reject non-ASCII characters (Unicode homoglyphs, combining chars, etc.)
  // Examples: ｗ (fullwidth), ᴡ (small capital), w̃ (combining tilde)
  // Check for characters outside ASCII range (0x01-0x7F, excluding null byte)
  // eslint-disable-next-line no-control-regex
  if (/[^\x01-\x7F]/.test(cmd)) {
    return true
  }

  // Reject curly braces (blocks) - too complex to parse
  if (cmd.includes('{') || cmd.includes('}')) {
    return true
  }

  // Reject newlines - multi-line commands are too complex
  if (cmd.includes('\n')) {
    return true
  }

  // Reject comments (# not immediately after s command)
  // Comments look like: #comment or start with #
  // Delimiter looks like: s#pattern#replacement#
  const hashIndex = cmd.indexOf('#')
  if (hashIndex !== -1 && !(hashIndex > 0 && cmd[hashIndex - 1] === 's')) {
    return true
  }

  // Reject negation operator
  // Negation can appear: at start (!/pattern/), after address (/pattern/!, 1,10!, $!)
  // Delimiter looks like: s!pattern!replacement! (has 's' before it)
  if (/^!/.test(cmd) || /[/\d$]!/.test(cmd)) {
    return true
  }

  // Reject tilde in GNU step address format (digit~digit, ,~digit, or $~digit)
  // Allow whitespace around tilde
  if (/\d\s*~\s*\d|,\s*~\s*\d|\$\s*~\s*\d/.test(cmd)) {
    return true
  }

  // Reject comma at start (bare comma is shorthand for 1,$ address range)
  if (/^,/.test(cmd)) {
    return true
  }

  // Reject comma followed by +/- (GNU offset addresses)
  if (/,\s*[+-]/.test(cmd)) {
    return true
  }

  // Reject backslash tricks:
  // 1. s\ (substitution with backslash delimiter)
  // 2. \X where X could be an alternate delimiter (|, #, %, etc.) - not regex escapes
  if (/s\\/.test(cmd) || /\\[|#%@]/.test(cmd)) {
    return true
  }

  // Reject escaped slashes followed by w/W (patterns like /\/path\/to\/file/w)
  if (/\\\/.*[wW]/.test(cmd)) {
    return true
  }

  // Reject malformed/suspicious patterns we don't understand
  // If there's a slash followed by non-slash chars, then whitespace, then dangerous commands
  // Examples: /pattern w file, /pattern e cmd, /foo X;w file
  if (/\/[^/]*\s+[wWeE]/.test(cmd)) {
    return true
  }

  // Reject malformed substitution commands that don't follow normal pattern
  // Examples: s/foobareoutput.txt (missing delimiters), s/foo/bar//w (extra delimiter)
  if (/^s\//.test(cmd) && !/^s\/[^/]*\/[^/]*\/[^/]*$/.test(cmd)) {
    return true
  }

  // PARANOID: Reject any command starting with 's' that ends with dangerous chars (w, W, e, E)
  // and doesn't match our known safe substitution pattern. This catches malformed s commands
  // with non-slash delimiters that might be trying to use dangerous flags.
  if (/^s./.test(cmd) && /[wWeE]$/.test(cmd)) {
    // Check if it's a properly formed substitution (any delimiter, not just /)
    const properSubst = /^s([^\\\n]).*?\1.*?\1[^wWeE]*$/.test(cmd)
    if (!properSubst) {
      return true
    }
  }

  // Check for dangerous write commands
  // Patterns: [address]w filename, [address]W filename, /pattern/w filename, /pattern/W filename
  // Simplified to avoid exponential backtracking (CodeQL issue)
  // Check for w/W in contexts where it would be a command (with optional whitespace)
  if (
    /^[wW]\s*\S+/.test(cmd) || // At start: w file
    /^\d+\s*[wW]\s*\S+/.test(cmd) || // After line number: 1w file or 1 w file
    /^\$\s*[wW]\s*\S+/.test(cmd) || // After $: $w file or $ w file
    /^\/[^/]*\/[IMim]*\s*[wW]\s*\S+/.test(cmd) || // After pattern: /pattern/w file
    /^\d+,\d+\s*[wW]\s*\S+/.test(cmd) || // After range: 1,10w file
    /^\d+,\$\s*[wW]\s*\S+/.test(cmd) || // After range: 1,$w file
    /^\/[^/]*\/[IMim]*,\/[^/]*\/[IMim]*\s*[wW]\s*\S+/.test(cmd) // After pattern range: /s/,/e/w file
  ) {
    return true
  }

  // Check for dangerous execute commands
  // Patterns: [address]e [command], /pattern/e [command], or commands starting with e
  // Simplified to avoid exponential backtracking (CodeQL issue)
  // Check for e in contexts where it would be a command (with optional whitespace)
  if (
    /^e/.test(cmd) || // At start: e cmd
    /^\d+\s*e/.test(cmd) || // After line number: 1e or 1 e
    /^\$\s*e/.test(cmd) || // After $: $e or $ e
    /^\/[^/]*\/[IMim]*\s*e/.test(cmd) || // After pattern: /pattern/e
    /^\d+,\d+\s*e/.test(cmd) || // After range: 1,10e
    /^\d+,\$\s*e/.test(cmd) || // After range: 1,$e
    /^\/[^/]*\/[IMim]*,\/[^/]*\/[IMim]*\s*e/.test(cmd) // After pattern range: /s/,/e/e
  ) {
    return true
  }

  // Check for substitution commands with dangerous flags
  // Pattern: s<delim>pattern<delim>replacement<delim>flags where flags contain w or e
  // Per POSIX, sed allows any character except backslash and newline as delimiter
  const substitutionMatch = cmd.match(/s([^\\\n]).*?\1.*?\1(.*?)$/)
  if (substitutionMatch) {
    const flags = substitutionMatch[2] || ''

    // Check for write flag: s/old/new/w filename or s/old/new/gw filename
    if (flags.includes('w') || flags.includes('W')) {
      return true
    }

    // Check for execute flag: s/old/new/e or s/old/new/ge
    if (flags.includes('e') || flags.includes('E')) {
      return true
    }
  }

  // Check for y (transliterate) command followed by dangerous operations
  // Pattern: y<delim>source<delim>dest<delim> followed by anything
  // The y command uses same delimiter syntax as s command
  // PARANOID: Reject any y command that has w/W/e/E anywhere after the delimiters
  const yCommandMatch = cmd.match(/y([^\\\n])/)
  if (yCommandMatch) {
    // If we see a y command, check if there's any w, W, e, or E in the entire command
    // This is paranoid but safe - y commands are rare and w/e after y is suspicious
    if (/[wWeE]/.test(cmd)) {
      return true
    }
  }

  return false
}
