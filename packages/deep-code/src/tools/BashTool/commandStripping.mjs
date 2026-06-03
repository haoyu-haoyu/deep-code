// Pure command-stripping for bash permission matching — extracted VERBATIM from
// bashPermissions.ts so this security-critical, deny-bypass-prevention logic is
// unit-testable under `node --test` (bashPermissions.ts imports `bun:bundle`,
// which node cannot load). NO LOGIC CHANGE. SECURITY: these regexes decide what
// the "real" command is that permission/deny rules match against — a stripping
// bug is a deny-rule bypass. Do NOT "simplify" the inline SECURITY notes.

/**
 * Whitelist of environment variables that are safe to strip from commands.
 * These variables CANNOT execute code or load libraries.
 *
 * SECURITY: These must NEVER be added to the whitelist:
 * - PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_* (execution/library loading)
 * - PYTHONPATH, NODE_PATH, CLASSPATH, RUBYLIB (module loading)
 * - GOFLAGS, RUSTFLAGS, NODE_OPTIONS (can contain code execution flags)
 * - HOME, TMPDIR, SHELL, BASH_ENV (affect system behavior)
 */
export const SAFE_ENV_VARS = new Set([
  // Go - build/runtime settings only
  'GOEXPERIMENT', // experimental features
  'GOOS', // target OS
  'GOARCH', // target architecture
  'CGO_ENABLED', // enable/disable CGO
  'GO111MODULE', // module mode

  // Rust - logging/debugging only
  'RUST_BACKTRACE', // backtrace verbosity
  'RUST_LOG', // logging filter

  // Node - environment name only (not NODE_OPTIONS!)
  'NODE_ENV',

  // Python - behavior flags only (not PYTHONPATH!)
  'PYTHONUNBUFFERED', // disable buffering
  'PYTHONDONTWRITEBYTECODE', // no .pyc files

  // Pytest - test configuration
  'PYTEST_DISABLE_PLUGIN_AUTOLOAD', // disable plugin loading
  'PYTEST_DEBUG', // debug output

  // API keys and authentication
  'ANTHROPIC_API_KEY', // API authentication

  // Locale and character encoding
  'LANG', // default locale
  'LANGUAGE', // language preference list
  'LC_ALL', // override all locale settings
  'LC_CTYPE', // character classification
  'LC_TIME', // time format
  'CHARSET', // character set preference

  // Terminal and display
  'TERM', // terminal type
  'COLORTERM', // color terminal indicator
  'NO_COLOR', // disable color output (universal standard)
  'FORCE_COLOR', // force color output
  'TZ', // timezone

  // Color configuration for various tools
  'LS_COLORS', // colors for ls (GNU)
  'LSCOLORS', // colors for ls (BSD/macOS)
  'GREP_COLOR', // grep match color (deprecated)
  'GREP_COLORS', // grep color scheme
  'GCC_COLORS', // GCC diagnostic colors

  // Display formatting
  'TIME_STYLE', // time display format for ls
  'BLOCK_SIZE', // block size for du/df
  'BLOCKSIZE', // alternative block size
])

/**
 * ANT-ONLY environment variables that are safe to strip from commands.
 * These are only enabled when USER_TYPE === 'ant'.
 *
 * SECURITY: These env vars are stripped before permission-rule matching, which
 * means `DOCKER_HOST=tcp://evil.com docker ps` matches a `Bash(docker ps:*)`
 * rule after stripping. This is INTENTIONALLY ANT-ONLY and MUST NEVER ship to
 * external users. DOCKER_HOST redirects the Docker daemon endpoint — stripping
 * it defeats prefix-based permission restrictions by hiding the network
 * endpoint from the permission check. KUBECONFIG similarly controls which
 * cluster kubectl talks to. These are convenience strippings for internal power
 * users who accept the risk.
 */
export const ANT_ONLY_SAFE_ENV_VARS = new Set([
  // Kubernetes and container config (config file pointers, not execution)
  'KUBECONFIG', // kubectl config file path — controls which cluster kubectl uses
  'DOCKER_HOST', // Docker daemon socket/endpoint — controls which daemon docker talks to

  // Cloud provider project/profile selection (just names/identifiers)
  'AWS_PROFILE', // AWS profile name selection
  'CLOUDSDK_CORE_PROJECT', // GCP project ID
  'CLUSTER', // generic cluster name

  // Internal cluster selection (just names/identifiers)
  'COO_CLUSTER', // coo cluster name
  'COO_CLUSTER_NAME', // coo cluster name (alternate)
  'COO_NAMESPACE', // coo namespace
  'COO_LAUNCH_YAML_DRY_RUN', // dry run mode

  // Feature flags (boolean/string flags only)
  'SKIP_NODE_VERSION_CHECK', // skip version check
  'EXPECTTEST_ACCEPT', // accept test expectations
  'CI', // CI environment indicator
  'GIT_LFS_SKIP_SMUDGE', // skip LFS downloads

  // GPU/Device selection (just device IDs)
  'CUDA_VISIBLE_DEVICES', // GPU device selection
  'JAX_PLATFORMS', // JAX platform selection

  // Display/terminal settings
  'COLUMNS', // terminal width
  'TMUX', // TMUX socket info

  // Test/debug configuration
  'POSTGRESQL_VERSION', // postgres version string
  'FIRESTORE_EMULATOR_HOST', // emulator host:port
  'HARNESS_QUIET', // quiet mode flag
  'TEST_CROSSCHECK_LISTS_MATCH_UPDATE', // test update flag
  'DBT_PER_DEVELOPER_ENVIRONMENTS', // DBT config
  'STATSIG_FORD_DB_CHECKS', // statsig DB check flag

  // Build configuration
  'ANT_ENVIRONMENT', // Anthropic environment name
  'ANT_SERVICE', // Anthropic service name
  'MONOREPO_ROOT_DIR', // monorepo root path

  // Version selectors
  'PYENV_VERSION', // Python version selection

  // Credentials (approved subset - these don't change exfil risk)
  'PGPASSWORD', // Postgres password
  'GH_TOKEN', // GitHub token
  'GROWTHBOOK_API_KEY', // self-hosted growthbook
])

/**
 * Strips full-line comments from a command. Only strips full-line comments
 * (lines where the entire line is a comment), not inline comments after a
 * command on the same line. If all lines were comments/empty, returns original.
 */
export function stripCommentLines(command) {
  const lines = command.split('\n')
  const nonCommentLines = lines.filter(line => {
    const trimmed = line.trim()
    // Keep lines that are not empty and don't start with #
    return trimmed !== '' && !trimmed.startsWith('#')
  })

  // If all lines were comments/empty, return original
  if (nonCommentLines.length === 0) {
    return command
  }

  return nonCommentLines.join('\n')
}

export function stripSafeWrappers(command) {
  // SECURITY: Use [ \t]+ not \s+ — \s matches \n/\r which are command
  // separators in bash. Matching across a newline would strip the wrapper from
  // one line and leave a different command on the next line for bash to execute.
  //
  // SECURITY: `(?:--[ \t]+)?` consumes the wrapper's own `--` so
  // `nohup -- rm -- -/../foo` strips to `rm -- -/../foo` (not `-- rm ...`
  // which would skip path validation with `--` as an unknown baseCmd).
  const SAFE_WRAPPER_PATTERNS = [
    // timeout: enumerate GNU long flags — no-value (--foreground,
    // --preserve-status, --verbose), value-taking in both =fused and
    // space-separated forms (--kill-after=5, --kill-after 5, --signal=TERM,
    // --signal TERM). Short: -v (no-arg), -k/-s with separate or fused value.
    // SECURITY: flag VALUES use allowlist [A-Za-z0-9_.+-] (signals are
    // TERM/KILL/9, durations are 5/5s/10.5). Previously [^ \t]+ matched
    // $ ( ) ` | ; & — `timeout -k$(id) 10 ls` stripped to `ls`, matched
    // Bash(ls:*), while bash expanded $(id) during word splitting BEFORE
    // timeout ran. Contrast ENV_VAR_PATTERN below which already allowlists.
    /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
    /^time[ \t]+(?:--[ \t]+)?/,
    // SECURITY: keep in sync with checkSemantics wrapper-strip (ast.ts
    // ~:1990-2080) AND stripWrappersFromArgv (pathValidation.ts ~:1260).
    // Now matches: `nice cmd`, `nice -n N cmd`, `nice -N cmd` (all forms
    // checkSemantics strips).
    /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
    // stdbuf: fused short (-o0), space-separated short (-o 0), and long-form
    // (--output=0) flags. SECURITY: keep in sync with skipStdbufFlags
    // (pathValidation.ts ~:1225) AND checkSemantics (ast.ts). Values use the
    // allowlist [A-Za-z0-9] (sizes are 0/L/4096/4K) for the same reason the
    // timeout pattern allowlists its values: at the string level an un-stripped
    // `stdbuf -o$(evil) cmd` must NOT reduce to `cmd` (bash expands $(evil)
    // during word-splitting before stdbuf runs). Long-form (`--output=0`) and
    // space-separated (`-o 0`) were previously unmatched — only fused `-o0` was
    // — letting `stdbuf --output=0 <denied>` slip a deny rule.
    /^stdbuf(?:[ \t]+(?:-[ioe][ \t]+[A-Za-z0-9]+|-[ioe][A-Za-z0-9]+|--(?:input|output|error)=[A-Za-z0-9]+))+[ \t]+(?:--[ \t]+)?/,
    // Bare `stdbuf <cmd>` (no flags) is ALSO a wrapper — it still execs <cmd>, so
    // a denied command run as `stdbuf <denied>` must reduce to <denied>.
    // SECURITY: strip only when the wrapped token starts with an injection-safe
    // command-name character [A-Za-z0-9_]. A broad `(?=[^-])` lookahead would
    // expose shell substitutions/operators at the string level — `stdbuf $(id)
    // cmd` / `stdbuf ;rm` would strip to `$(id) cmd` / `;rm` (bash expands those
    // during word-splitting before stdbuf runs). Restricting to [A-Za-z0-9_]
    // excludes $ ` ; | & ( ) < > ' " and `-`, so injection forms fail closed
    // (and dash flags fall to the allowlisted flag pattern above). KEEP IN SYNC
    // with skipStdbufFlags (argvWrapperStripping) + checkSemantics (ast.ts).
    /^stdbuf[ \t]+(?=[A-Za-z0-9_])/,
    /^nohup[ \t]+(?:--[ \t]+)?/,
    // Benign scheduler wrappers (setsid/ionice/chrt/taskset) — transparent (the
    // wrapped command still runs), so a denied command run as `<wrapper> <denied>`
    // must reduce to <denied>. SECURITY: each requires a non-dash command start
    // (?=[A-Za-z0-9_]) so injection / `-p` pid-mode / unknown-flag forms fail
    // closed; flag values use [A-Za-z0-9-]/digit/hex allowlists (no expansion).
    // Privilege/exec wrappers (sudo/doas/su/gdb/strace/perf/systemd-run/
    // proxychains) are deliberately NOT here — stripping them would auto-approve
    // `sudo rm` as `rm`. KEEP IN SYNC with skip{Ionice,Chrt,Taskset}Flags
    // (argvWrapperStripping) + checkSemantics (ast.ts).
    /^setsid(?:[ \t]+(?:-c|-f|-w|--ctty|--fork|--wait))*[ \t]+(?=[A-Za-z0-9_])/,
    /^ionice(?:[ \t]+(?:-[cn][ \t]+[A-Za-z0-9-]+|-[cn][A-Za-z0-9-]+|-t|--ignore))*[ \t]+(?=[A-Za-z0-9_])/,
    /^chrt(?:[ \t]+(?:-f|-r|-b|-o|-i|-d|-R|-a|--(?:fifo|rr|batch|other|idle|deadline|reset-on-fork|all-tasks)))*[ \t]+\d+[ \t]+(?=[A-Za-z0-9_])/,
    /^taskset(?:[ \t]+(?:-c|--cpu-list|-a|--all-tasks))*[ \t]+(?:0x[0-9a-fA-F]+|[0-9][0-9,-]*)[ \t]+(?=[A-Za-z0-9_])/,
  ]

  // Pattern for environment variables. SECURITY: Only matches unquoted values
  // with safe characters (no $(), `, $var, ;|&). Trailing whitespace MUST be
  // [ \t]+ (horizontal only), NOT \s+ (\s matches \n/\r command separators).
  const ENV_VAR_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_./:-]+)[ \t]+/

  let stripped = command
  let previousStripped = ''

  // Phase 1: Strip leading env vars and comments only. In bash, env var
  // assignments before a command (VAR=val cmd) are genuine shell-level
  // assignments. These are safe to strip for permission matching.
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    const envVarMatch = stripped.match(ENV_VAR_PATTERN)
    if (envVarMatch) {
      const varName = envVarMatch[1]
      const isAntOnlySafe =
        process.env.USER_TYPE === 'ant' && ANT_ONLY_SAFE_ENV_VARS.has(varName)
      if (SAFE_ENV_VARS.has(varName) || isAntOnlySafe) {
        stripped = stripped.replace(ENV_VAR_PATTERN, '')
      }
    }
  }

  // Phase 2: Strip wrapper commands and comments only. Do NOT strip env vars.
  // Wrapper commands (timeout, time, nice, nohup) use execvp to run their
  // arguments, so VAR=val after a wrapper is treated as the COMMAND to execute,
  // not as an env var assignment. (HackerOne #3543050)
  previousStripped = ''
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    for (const pattern of SAFE_WRAPPER_PATTERNS) {
      stripped = stripped.replace(pattern, '')
    }
  }

  return stripped.trim()
}

/**
 * Env vars that make a *different binary* run (injection or resolution hijack).
 * Heuristic only — export-&& form bypasses this, and excludedCommands isn't a
 * security boundary anyway.
 */
export const BINARY_HIJACK_VARS = /^(LD_|DYLD_|PATH$)/

/**
 * Strip ALL leading env var prefixes from a command, regardless of whether the
 * var name is in the safe-list. Used for deny/ask rule matching: when a user
 * denies `claude` or `rm`, the command should stay blocked even if prefixed
 * with arbitrary env vars like `FOO=bar claude`. (stripSafeWrappers' safe-list
 * is correct for ALLOW rules; deny rules must be harder to circumvent.)
 *
 * Also used for sandbox.excludedCommands matching (not a security boundary),
 * with BINARY_HIJACK_VARS as a blocklist.
 *
 * SECURITY: Uses a broader value pattern than stripSafeWrappers — excludes only
 * actual shell injection characters ($, backtick, ;, |, &, parens, redirects,
 * quotes, backslash) and whitespace. Characters like =, +, @, ~, , are harmless
 * in unquoted env var assignment position and must be matched to prevent
 * trivial bypass via e.g. `FOO=a=b denied_command`.
 *
 * @param {string} command
 * @param {RegExp} [blocklist] tested against each var name; matching vars are
 *   NOT stripped (and stripping stops there). Omit for deny rules; pass
 *   BINARY_HIJACK_VARS for excludedCommands.
 * @returns {string}
 */
export function stripAllLeadingEnvVars(command, blocklist) {
  // Broader value pattern for deny-rule stripping. SECURITY: Trailing whitespace
  // MUST be [ \t]+ (horizontal only), NOT \s+. $ is excluded from value classes
  // to block $(cmd)/${var}/$((expr)). $VAR is not stripped (adding it creates
  // ReDoS risk, CodeQL #671, and $VAR bypasses are low-priority).
  const ENV_VAR_PATTERN =
    /^([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?)\+?=(?:'[^'\n\r]*'|"(?:\\.|[^"$`\\\n\r])*"|\\.|[^ \t\n\r$`;|&()<>\\\\'"])*[ \t]+/

  let stripped = command
  let previousStripped = ''

  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    const m = stripped.match(ENV_VAR_PATTERN)
    if (!m) continue
    if (blocklist?.test(m[1])) break
    stripped = stripped.slice(m[0].length)
  }

  return stripped.trim()
}

/**
 * Strip a leading `env [-i|-0|-v|-u NAME]... ` wrapper so a denied command run
 * as `env <denied>` still matches its deny rule. Returns the wrapped command,
 * or the input unchanged if there is no `env` prefix or it is unparseable.
 *
 * DENY/ASK PATH ONLY. `env` can set arbitrary environment (including
 * LD_PRELOAD / PATH that hijack which binary actually runs), so it is
 * deliberately absent from stripSafeWrappers' ALLOW-rule safe-list — stripping
 * it for allow matching would let `env LD_PRELOAD=/evil.so curl` satisfy
 * Bash(curl:*). For deny/ask matching the opposite is required (a denied
 * command must stay denied under any wrapper), so this is applied only in
 * filterRulesByContentsMatchingInput's stripAllEnvVars fixed-point loop.
 *
 * The `VAR=val` assignments that follow `env` are left to stripAllLeadingEnvVars
 * (applied together in that same loop), so this only peels the `env` token and
 * its own dash-flags. Fails closed on -S (argv splitter), -C/-P (altwd/altpath),
 * `--`, and any unknown flag — leaving the command unstripped rather than
 * guessing the real base command.
 *
 * SECURITY: KEEP IN SYNC with skipEnvFlags (pathValidation.ts ~:1244) and
 * checkSemantics' env unwrap (ast.ts). Trailing whitespace is [ \t]+ (horizontal
 * only) — \n/\r are command separators and must not be crossed.
 *
 * @param {string} command
 * @returns {string}
 */
export function stripEnvCommandPrefix(command) {
  const envToken = command.match(/^env[ \t]+/)
  if (!envToken) return command
  let rest = command.slice(envToken[0].length)
  for (;;) {
    const noValueFlag = rest.match(/^(?:-i|-0|-v)[ \t]+/)
    if (noValueFlag) {
      rest = rest.slice(noValueFlag[0].length)
      continue
    }
    const unsetFlag = rest.match(/^-u[ \t]+[^ \t\n\r]+[ \t]+/)
    if (unsetFlag) {
      rest = rest.slice(unsetFlag[0].length)
      continue
    }
    // -S/-C/-P/--/unknown dash-flag: fail closed (mirror skipEnvFlags === -1).
    if (rest.startsWith('-')) return command
    break
  }
  // rest now begins with the VAR=val assignments (handled by the loop's
  // stripAllLeadingEnvVars) or the wrapped command itself. Empty => no wrapped
  // command (e.g. `env -i`) => leave the original untouched.
  return rest.length > 0 ? rest : command
}
