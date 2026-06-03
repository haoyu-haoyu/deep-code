// Pure, DI'd core of isCommandSafeViaFlagParsing, extracted from
// readOnlyValidation.ts so it is unit-testable under `node --test` (the .ts
// imports a bun-tainted shell parser + a ~1000-line COMMAND_ALLOWLIST config).
//
// SECURITY: this is the parser-DIFFERENTIAL guard for read-only auto-approval.
// shell-quote preserves `$VAR` as LITERAL text in tokens, but bash expands it at
// runtime — that differential is a documented file-write / RCE vector
// (`git diff "$Z--output=/tmp/x"`, `rg . "$Z--pre=bash" FILE`, `ps ax"$Z"e`).
// The `$`-token rejection + brace-expansion guard + git-ls-remote URL guard +
// operator rejection here defend against it, and MUST run before validateFlags.
//
// Impure deps are injected so the security logic is testable in isolation:
//   - parseShellCommand(command) -> { success, tokens }  (real: tryParseShellCommand)
//   - getAllowlist() -> Record<cmdPattern, CommandConfig>  (real: getCommandAllowlist)
//   - validateFlags(tokens, commandTokens, config, opts) -> boolean
//   - safeXargsTargetCommands: string[]
// Extracted VERBATIM (behavior-preserving); readOnlyValidation.ts wires the
// real deps in the thin isCommandSafeViaFlagParsing wrapper.

export function isCommandSafeViaFlagParsingCore(
  command,
  { parseShellCommand, getAllowlist, validateFlags, safeXargsTargetCommands },
) {
  // Parse the command to get individual tokens using shell-quote for accuracy
  // Handle glob operators by converting them to strings, they don't matter from the perspective
  // of this function
  const parseResult = parseShellCommand(command)
  if (!parseResult.success) return false

  const parsed = parseResult.tokens.map(token => {
    if (typeof token !== 'string') {
      token = token
      if (token.op === 'glob') {
        return token.pattern
      }
    }
    return token
  })

  // If there are operators (pipes, redirects, etc.), it's not a simple command.
  // Breaking commands down into their constituent parts is handled upstream of
  // this function, so we reject anything with operators here.
  const hasOperators = parsed.some(token => typeof token !== 'string')
  if (hasOperators) {
    return false
  }

  // Now we know all tokens are strings
  const tokens = parsed

  if (tokens.length === 0) {
    return false
  }

  // Find matching command configuration
  let commandConfig
  let commandTokens = 0

  // Check for multi-word commands first (e.g., "git diff", "git stash list")
  const allowlist = getAllowlist()
  for (const [cmdPattern] of Object.entries(allowlist)) {
    const cmdTokens = cmdPattern.split(' ')
    if (tokens.length >= cmdTokens.length) {
      let matches = true
      for (let i = 0; i < cmdTokens.length; i++) {
        if (tokens[i] !== cmdTokens[i]) {
          matches = false
          break
        }
      }
      if (matches) {
        commandConfig = allowlist[cmdPattern]
        commandTokens = cmdTokens.length
        break
      }
    }
  }

  if (!commandConfig) {
    return false // Command not in allowlist
  }

  // Special handling for git ls-remote to reject URLs that could lead to data exfiltration
  if (tokens[0] === 'git' && tokens[1] === 'ls-remote') {
    // Check if any argument looks like a URL or remote specification
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i]
      if (token && !token.startsWith('-')) {
        // Reject HTTP/HTTPS URLs
        if (token.includes('://')) {
          return false
        }
        // Reject SSH URLs like git@github.com:user/repo.git
        if (token.includes('@') || token.includes(':')) {
          return false
        }
        // Reject variable references
        if (token.includes('$')) {
          return false
        }
      }
    }
  }

  // SECURITY: Reject ANY token containing `$` (variable expansion). The
  // `env => \`$${env}\`` callback at line 825 preserves `$VAR` as LITERAL TEXT
  // in tokens, but bash expands it at runtime (unset vars → empty string).
  // This parser differential defeats BOTH validateFlags and callbacks:
  //
  //   (1) `$VAR`-prefix defeats validateFlags `startsWith('-')` check:
  //       `git diff "$Z--output=/tmp/pwned"` → token `$Z--output=/tmp/pwned`
  //       (starts with `$`) falls through as positional at ~:1730. Bash runs
  //       `git diff --output=/tmp/pwned`. ARBITRARY FILE WRITE, zero perms.
  //
  //   (2) `$VAR`-prefix → RCE via `rg --pre`:
  //       `rg . "$Z--pre=bash" FILE` → executes `bash FILE`. rg's config has
  //       no regex and no callback. SINGLE-STEP ARBITRARY CODE EXECUTION.
  //
  //   (3) `$VAR`-infix defeats additionalCommandIsDangerousCallback regex:
  //       `ps ax"$Z"e` → token `ax$Ze`. The ps callback regex
  //       `/^[a-zA-Z]*e[a-zA-Z]*$/` fails on `$` → "not dangerous". Bash runs
  //       `ps axe` → env vars for all processes. A fix limited to `$`-PREFIXED
  //       tokens would NOT close this.
  //
  // We check ALL tokens after the command prefix. Any `$` means we cannot
  // determine the runtime token value, so we cannot verify read-only safety.
  // This check must run BEFORE validateFlags and BEFORE callbacks.
  for (let i = commandTokens; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    // Reject any token containing $ (variable expansion)
    if (token.includes('$')) {
      return false
    }
    // Reject tokens with BOTH `{` and `,` (brace expansion obfuscation).
    // `git diff {@'{'0},--output=/tmp/pwned}` → shell-quote strips quotes
    // → token `{@{0},--output=/tmp/pwned}` has `{` + `,` → brace expansion.
    // This is defense-in-depth with validateBraceExpansion in bashSecurity.ts.
    // We require BOTH `{` and `,` to avoid false positives on legitimate
    // patterns: `stash@{0}` (git ref, has `{` no `,`), `{{.State}}` (Go
    // template, no `,`), `prefix-{}-suffix` (xargs, no `,`). Sequence form
    // `{1..5}` also needs checking (has `{` + `..`).
    if (token.includes('{') && (token.includes(',') || token.includes('..'))) {
      return false
    }
  }

  // Validate flags starting after the command tokens
  if (
    !validateFlags(tokens, commandTokens, commandConfig, {
      commandName: tokens[0],
      rawCommand: command,
      xargsTargetCommands:
        tokens[0] === 'xargs' ? safeXargsTargetCommands : undefined,
    })
  ) {
    return false
  }

  if (commandConfig.regex && !commandConfig.regex.test(command)) {
    return false
  }
  if (!commandConfig.regex && /`/.test(command)) {
    return false
  }
  // Block newlines and carriage returns in grep/rg patterns as they can be used for injection
  if (
    !commandConfig.regex &&
    (tokens[0] === 'rg' || tokens[0] === 'grep') &&
    /[\n\r]/.test(command)
  ) {
    return false
  }
  if (
    commandConfig.additionalCommandIsDangerousCallback &&
    commandConfig.additionalCommandIsDangerousCallback(
      command,
      tokens.slice(commandTokens),
    )
  ) {
    return false
  }

  return true
}
