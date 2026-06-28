/**
 * From a command that the legacy gate classified as an "unsafe compound"
 * (a background list `a & b` / `a |& b`, a subshell `(cmd)`, a command group,
 * etc. — anything that splits into multiple parts but is NOT a plain
 * COMMAND_LIST_SEPARATOR list), select the subcommands worth checking against
 * tool deny rules.
 *
 * Why this exists: bashToolCheckCommandOperatorPermissions returns a blanket
 * `ask` for an unsafe compound WITHOUT consulting deny rules, so a denied
 * command hidden behind `&` / `|&` / `(...)` (none of which are
 * COMMAND_LIST_SEPARATORS) silently downgraded a hard `deny` to a soft `ask` —
 * unlike `&&` / `;` / `|`, which reach the per-subcommand deny check. Feeding
 * these selected subcommands back through the permission system (mirroring the
 * pipe path's segmentedCommandPermissionResult) lets a deny rule still fire.
 *
 * Selection: split on operators (splitFn = splitCommand_DEPRECATED), trim, and
 * keep only tokens that contain a command word character. Pure-operator /
 * punctuation tokens (`&`, `|&`, `(`, `)`, `;`, `&&`, `>>`, ...) carry no word
 * character, can never match a `Bash(<cmd>:*)` rule, and are dropped so they are
 * not needlessly run through the full permission system.
 *
 * Pure: command + injected splitter in, subcommand strings out.
 *
 * @param {string} command
 * @param {(c: string) => Array<string | null | undefined>} splitFn
 * @returns {string[]} subcommands to deny-check, in order
 */
export function subcommandsForDenyCheck(command, splitFn) {
  const out = []
  for (const raw of splitFn(command)) {
    const sub = (raw ?? '').trim()
    // Keep only tokens with a command word char; drop bare operators/punctuation.
    if (sub && /[A-Za-z0-9_]/.test(sub)) {
      out.push(sub)
    }
  }
  return out
}
