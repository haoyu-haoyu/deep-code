// Command-prefix extraction for permission-rule SUGGESTIONS — extracted from
// bashPermissions.ts so this security-relevant logic is unit-testable under
// `node --test` (bashPermissions.ts imports `bun:bundle`, which node cannot load).
//
// SECURITY: these produce the `Bash(<prefix>:*)` rule a user is offered to save
// ("don't ask again"). If the prefix is broader than the command the user saw, the
// saved rule grants more than intended. The BARE_SHELL_PREFIXES guard below blocks
// prefixes whose FIRST word re-execs/escalates (sh/bash/env/xargs/sudo/eval/...),
// for which `Bash(<that> ...:*)` would be arbitrary code execution or privilege
// escalation via the wrapped command.

import {
  ANT_ONLY_SAFE_ENV_VARS,
  SAFE_ENV_VARS,
} from './commandStripping.mjs'

// Env-var assignment prefix (VAR=value).
export const ENV_VAR_ASSIGN_RE = /^[A-Za-z_]\w*=/

// First words that must NEVER become a suggested prefix rule. A bare-prefix
// suggestion like `bash:*`/`sh:*` allows arbitrary code via `-c`; wrapper
// suggestions like `env:*`/`sudo:*`/`xargs:*` do the same — `env`/`sudo`/`xargs`
// are NOT in stripSafeWrappers' allow-list, so `env bash -c "evil"` /
// `sudo systemctl mask sshd` / `xargs bash -c "evil"` survive stripping and hit the
// prefix matcher. `eval`/`source`/`watch`/`coproc` likewise re-exec/source arbitrary
// code as their argument. Shell list mirrors DANGEROUS_SHELL_PREFIXES in
// src/utils/shell/prefix.ts which guarded the old Haiku extractor.
export const BARE_SHELL_PREFIXES = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'ksh',
  'dash',
  'cmd',
  'powershell',
  'pwsh',
  // wrappers / runners that exec (or source) their argument as a command
  'env',
  'xargs',
  // eval/source/`.`-family + transparent runners: `Bash(eval:*)`/`Bash(source:*)`/
  // `Bash(watch:*)`/`Bash(coproc:*)` would auto-approve running ANYTHING they wrap.
  'eval',
  'source',
  'watch',
  'coproc',
  // SECURITY: checkSemantics (ast.ts) strips these wrappers to check the
  // wrapped command. Suggesting `Bash(nice:*)` would be ≈ `Bash(*)` — users
  // would add it after a prompt, then `nice rm -rf /` passes semantics while
  // deny/cd+git gates see 'nice' (SAFE_WRAPPER_PATTERNS didn't strip bare `nice`
  // until that fix). Block these from ever being suggested.
  'nice',
  'stdbuf',
  'nohup',
  'timeout',
  'time',
  // Scheduler wrappers stripSafeWrappers (commandStripping.mjs) ADDED LATER as
  // transparent but which never made it into this guard — the same ≈`Bash(*)`
  // escalation as nice/timeout above: `ionice -c2 npm test` would suggest
  // `Bash(ionice:*)`, then `ionice rm -rf /` strips to `rm -rf /` for the deny
  // gate while the saved allow-rule still prefix-matches the raw `ionice …`.
  // KEEP IN SYNC with the setsid/ionice/chrt/taskset patterns in
  // stripSafeWrappers (commandStripping.mjs) + checkSemantics (ast.ts).
  'setsid',
  'ionice',
  'chrt',
  'taskset',
  // privilege escalation / execution-context change — `Bash(sudo:*)` from
  // `sudo -u foo ...` would auto-approve any future sudo invocation; su/runuser/
  // setpriv/chroot/unshare likewise run a wrapped command with elevated or changed
  // privileges/root/namespace, so blanket-allowing them is ≈ Bash(*).
  'sudo',
  'doas',
  'pkexec',
  'su',
  'runuser',
  'setpriv',
  'chroot',
  'unshare',
])

const SUBCOMMAND_SHAPE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/**
 * Extract a stable command prefix (command + subcommand) from a raw command string.
 * Skips leading SAFE env var assignments; returns null (→ fall back to exact match)
 * if a non-safe env var is seen, if the first command is a re-exec/escalation prefix
 * (BARE_SHELL_PREFIXES), or if the second token isn't a subcommand shape.
 *
 *   'git commit -m "fix typo"'      → 'git commit'
 *   'NODE_ENV=prod npm run build'   → 'npm run' (NODE_ENV is safe)
 *   'MY_VAR=val npm run build'      → null (MY_VAR is not safe)
 *   'sudo systemctl restart nginx'  → null (sudo re-execs/escalates) [SECURITY guard]
 *   'env sh deploy.sh'              → null (env re-execs)            [SECURITY guard]
 *   'ls -la'                        → null (flag, not a subcommand)
 *
 * @param {string} command
 * @param {boolean} [isAnt] whether ANT_ONLY_SAFE_ENV_VARS apply (default from env)
 * @returns {string | null}
 */
export function getSimpleCommandPrefix(
  command,
  isAnt = process.env.USER_TYPE === 'ant',
) {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i])) {
    const varName = tokens[i].split('=')[0]
    const isAntOnlySafe = isAnt && ANT_ONLY_SAFE_ENV_VARS.has(varName)
    if (!SAFE_ENV_VARS.has(varName) && !isAntOnlySafe) {
      return null
    }
    i++
  }

  const remaining = tokens.slice(i)
  if (remaining.length < 2) return null

  // SECURITY: never suggest a 2-word prefix whose FIRST word re-execs/escalates.
  // `Bash(sudo systemctl:*)` auto-approves arbitrary root operations; `Bash(env sh:*)`
  // / `Bash(xargs bash:*)` are arbitrary code execution via the wrapped command.
  // getFirstWordPrefix already guards this — getSimpleCommandPrefix is the path the
  // suggestion UI tries FIRST and lacked it. Fall back to exact match.
  if (BARE_SHELL_PREFIXES.has(remaining[0])) return null

  const subcmd = remaining[1]
  // Second token must look like a subcommand (e.g., "commit", "run", "compose"),
  // not a flag (-rf), filename (file.txt), path (/tmp), URL, or number (755).
  if (!SUBCOMMAND_SHAPE_RE.test(subcmd)) return null
  return remaining.slice(0, 2).join(' ')
}

/**
 * UI-only fallback: extract the first word alone when getSimpleCommandPrefix declines.
 * Skips safe env var prefixes; returns null for non-safe env vars, non-command-shape
 * first words, or re-exec/escalation prefixes (BARE_SHELL_PREFIXES).
 *
 * @param {string} command
 * @param {boolean} [isAnt]
 * @returns {string | null}
 */
export function getFirstWordPrefix(
  command,
  isAnt = process.env.USER_TYPE === 'ant',
) {
  const tokens = command.trim().split(/\s+/).filter(Boolean)

  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i])) {
    const varName = tokens[i].split('=')[0]
    const isAntOnlySafe = isAnt && ANT_ONLY_SAFE_ENV_VARS.has(varName)
    if (!SAFE_ENV_VARS.has(varName) && !isAntOnlySafe) {
      return null
    }
    i++
  }

  const cmd = tokens[i]
  if (!cmd) return null
  // Same shape check as the subcommand regex above: rejects paths
  // (./script.sh, /usr/bin/python), flags, numbers, filenames.
  if (!SUBCOMMAND_SHAPE_RE.test(cmd)) return null
  if (BARE_SHELL_PREFIXES.has(cmd)) return null
  return cmd
}
