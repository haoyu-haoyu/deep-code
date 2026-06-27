/**
 * Whether a shell-quote token list is a SIMPLE `cmd ... --help` command: every
 * token is a plain string (no shell operators or comments), the only flag is
 * `--help`, and every non-flag token is alphanumeric.
 *
 * shell-quote represents operators and comments as OBJECTS (e.g. `{ op: '&&' }`,
 * `{ comment: '...' }`), not strings. The previous loop only validated
 * `typeof token === 'string'` entries and SILENTLY SKIPPED those objects, so a
 * compound command that merely ends in `--help` — e.g. `git && log --help` —
 * passed as a "help command". It was then offered as an auto-allowable
 * permission prefix (`git && log --help:*`) that also covers the `&&` operator,
 * i.e. a second command. Rejecting any non-string token makes only a genuinely
 * simple help invocation qualify.
 *
 * @param {Array<unknown>} tokens  the shell-quote parse() output
 * @returns {boolean}
 */
export function isSimpleHelpCommandTokens(tokens) {
  let foundHelp = false
  for (const token of tokens) {
    // Operators ({op}) and comments ({comment}) are not part of a simple help
    // command — their presence means the command does more than ask for help.
    if (typeof token !== 'string') return false
    if (token.startsWith('-')) {
      // Only --help is allowed; any other flag means it is not a plain help call.
      if (token === '--help') foundHelp = true
      else return false
    } else if (!/^[a-zA-Z0-9]+$/.test(token)) {
      // Non-flag tokens must be bare alphanumeric (no paths, special chars).
      return false
    }
  }
  return foundHelp
}
