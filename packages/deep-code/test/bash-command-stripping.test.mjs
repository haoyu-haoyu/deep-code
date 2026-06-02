import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SAFE_ENV_VARS,
  ANT_ONLY_SAFE_ENV_VARS,
  BINARY_HIJACK_VARS,
  stripCommentLines,
  stripSafeWrappers,
  stripAllLeadingEnvVars,
} from '../src/tools/BashTool/commandStripping.mjs'

// ── bash command-stripping (deny-bypass prevention) ─────────────────────────
// SECURITY-critical: these functions decide the "real" command that permission /
// deny rules match against. A stripping bug is a deny-rule bypass. This logic
// was previously trapped in bashPermissions.ts (imports bun:bundle, not
// node-testable) with NO unit coverage; here it is exercised against adversarial
// bypass inputs. (Behavior is a verbatim extraction — no logic change.)

function withUserType(value, fn) {
  const prev = process.env.USER_TYPE
  if (value === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = prev
  }
}

// --- stripSafeWrappers: env vars (ALLOW-rule semantics — safe-list only) -----

test('stripSafeWrappers: a SAFE env var is stripped; a non-safe one is NOT', () => {
  assert.equal(stripSafeWrappers('TZ=UTC echo hi'), 'echo hi')
  assert.equal(stripSafeWrappers('NODE_ENV=production npm test'), 'npm test')
  // FOO is not in the safe-list → must remain so `Bash(echo:*)` does not match.
  assert.equal(stripSafeWrappers('FOO=bar echo hi'), 'FOO=bar echo hi')
})

test('stripSafeWrappers: execution/library-loading env vars are NEVER stripped', () => {
  for (const cmd of [
    'LD_PRELOAD=/evil.so curl x',
    'LD_LIBRARY_PATH=/evil curl x',
    'DYLD_INSERT_LIBRARIES=/evil curl x',
    'PATH=/evil:/bin ls',
    'NODE_OPTIONS=--require=/evil node app',
    'PYTHONPATH=/evil python s',
    'BASH_ENV=/evil bash s',
  ]) {
    assert.equal(stripSafeWrappers(cmd), cmd, `must not strip: ${cmd}`)
  }
})

test('stripSafeWrappers: an unsafe value (injection chars) blocks even a safe var', () => {
  // TZ is safe, but the value pattern only allows [A-Za-z0-9_./:-]; a ';' (command
  // separator) is not matched, so the prefix is NOT stripped.
  assert.equal(stripSafeWrappers('TZ=a;rm -rf / echo hi'), 'TZ=a;rm -rf / echo hi')
})

test('stripSafeWrappers: never strips across a newline (\\n is a command separator)', () => {
  // TZ=UTC alone on line 1, a different command on line 2: must NOT strip the
  // assignment and run line 2 as the "real" command.
  assert.equal(stripSafeWrappers('TZ=UTC\necho evil'), 'TZ=UTC\necho evil')
})

test('stripSafeWrappers: ANT-only env vars strip ONLY for ant users', () => {
  withUserType(undefined, () => {
    assert.equal(stripSafeWrappers('DOCKER_HOST=tcp://evil docker ps'), 'DOCKER_HOST=tcp://evil docker ps')
  })
  withUserType('ant', () => {
    assert.equal(stripSafeWrappers('DOCKER_HOST=tcp://evil docker ps'), 'docker ps')
  })
})

// --- stripSafeWrappers: command wrappers -------------------------------------

test('stripSafeWrappers: timeout / time / nice / nohup / stdbuf are stripped', () => {
  assert.equal(stripSafeWrappers('timeout 10 ls'), 'ls')
  assert.equal(stripSafeWrappers('timeout -k 5 10 ls'), 'ls')
  assert.equal(stripSafeWrappers('timeout --signal=TERM 10 ls'), 'ls')
  assert.equal(stripSafeWrappers('time ls'), 'ls')
  assert.equal(stripSafeWrappers('nice rm -rf /tmp/x'), 'rm -rf /tmp/x') // bare nice
  assert.equal(stripSafeWrappers('nice -n 5 rm x'), 'rm x')
  assert.equal(stripSafeWrappers('nice -5 rm x'), 'rm x') // legacy -N
  assert.equal(stripSafeWrappers('nohup curl x'), 'curl x')
  assert.equal(stripSafeWrappers('stdbuf -o0 cmd x'), 'cmd x')
})

test('stripSafeWrappers: timeout flag-VALUE injection is NOT stripped (security regression guard)', () => {
  // `timeout -k$(id) 10 ls` — the flag value $(id) is not in the allowlist, so
  // the whole timeout wrapper does NOT match → not stripped to `ls` (bash would
  // expand $(id) during word splitting BEFORE timeout runs).
  const out = stripSafeWrappers('timeout -k$(id) 10 ls')
  assert.notEqual(out, 'ls')
  assert.match(out, /timeout/)
})

test('stripSafeWrappers: a wrapper consumes its own `--` (no `--` baseCmd bypass)', () => {
  // nohup -- rm -- -/../foo → rm -- -/../foo (NOT `-- rm ...` which would make
  // `--` the baseCmd and skip path validation).
  assert.equal(stripSafeWrappers('nohup -- rm -- -/../foo'), 'rm -- -/../foo')
})

test('stripSafeWrappers: env vars after a wrapper are NOT stripped (HackerOne #3543050)', () => {
  // After a wrapper, VAR=val is the COMMAND argv (execvp), not a shell
  // assignment — phase 2 must not strip it.
  assert.equal(stripSafeWrappers('timeout 10 TZ=UTC echo hi'), 'TZ=UTC echo hi')
})

test('stripSafeWrappers: full-line comments are stripped', () => {
  assert.equal(stripSafeWrappers('# explain\nls /tmp'), 'ls /tmp')
})

// --- stripAllLeadingEnvVars: deny-rule matching (broader, must be hard to bypass)

test('stripAllLeadingEnvVars: strips ARBITRARY leading env vars (deny must stay blocked)', () => {
  assert.equal(stripAllLeadingEnvVars('FOO=bar claude'), 'claude')
  assert.equal(stripAllLeadingEnvVars('A=1 B=2 rm -rf /'), 'rm -rf /')
})

test('stripAllLeadingEnvVars: the FOO=a=b bypass is closed (= in value is matched)', () => {
  assert.equal(stripAllLeadingEnvVars('FOO=a=b denied_command'), 'denied_command')
})

test('stripAllLeadingEnvVars: quoted values strip; injection ($/backtick/;) does NOT', () => {
  assert.equal(stripAllLeadingEnvVars("FOO='a b c' cmd"), 'cmd')
  assert.equal(stripAllLeadingEnvVars('FOO="a b c" cmd'), 'cmd')
  // $(...) / ${...} must block stripping (would otherwise hide a substitution).
  assert.equal(stripAllLeadingEnvVars('FOO=$(evil) cmd'), 'FOO=$(evil) cmd')
  assert.equal(stripAllLeadingEnvVars('FOO=a;rm cmd'), 'FOO=a;rm cmd')
})

test('stripAllLeadingEnvVars: BINARY_HIJACK_VARS blocklist stops stripping a hijack var', () => {
  // Without a blocklist (deny rules): strip everything.
  assert.equal(stripAllLeadingEnvVars('LD_PRELOAD=/evil.so cmd'), 'cmd')
  // With BINARY_HIJACK_VARS (excludedCommands): a hijack var is NOT stripped and
  // stripping stops there, so the command stays "dangerous-looking".
  assert.equal(stripAllLeadingEnvVars('LD_PRELOAD=/evil.so cmd', BINARY_HIJACK_VARS), 'LD_PRELOAD=/evil.so cmd')
  assert.equal(stripAllLeadingEnvVars('PATH=/evil cmd', BINARY_HIJACK_VARS), 'PATH=/evil cmd')
  // A non-hijack var before a hijack var: stripping stops at the hijack var.
  assert.equal(stripAllLeadingEnvVars('FOO=bar LD_PRELOAD=/evil cmd', BINARY_HIJACK_VARS), 'LD_PRELOAD=/evil cmd')
})

// --- BINARY_HIJACK_VARS regex -----------------------------------------------

test('BINARY_HIJACK_VARS matches LD_*/DYLD_*/exact-PATH, not innocent names', () => {
  for (const v of ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'PATH']) {
    assert.ok(BINARY_HIJACK_VARS.test(v), `should flag ${v}`)
  }
  for (const v of ['PATHEXT', 'MYPATH', 'FOO', 'NODE_ENV']) {
    assert.ok(!BINARY_HIJACK_VARS.test(v), `should NOT flag ${v}`)
  }
})

// --- stripCommentLines -------------------------------------------------------

test('stripCommentLines: drops full-line comments, keeps inline, preserves all-comment input', () => {
  assert.equal(stripCommentLines('# c1\nls\n# c2'), 'ls')
  assert.equal(stripCommentLines('ls # inline kept'), 'ls # inline kept')
  assert.equal(stripCommentLines('# only\n# comments'), '# only\n# comments') // all comments → original
})

// --- the constants are the documented safe-lists (regression guard) ----------

test('SAFE_ENV_VARS excludes every execution/loading var; ANT-only has DOCKER_HOST/KUBECONFIG', () => {
  for (const forbidden of ['PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'PYTHONPATH', 'BASH_ENV', 'HOME', 'SHELL']) {
    assert.ok(!SAFE_ENV_VARS.has(forbidden), `${forbidden} must NEVER be safe-listed`)
  }
  assert.ok(SAFE_ENV_VARS.has('TZ') && SAFE_ENV_VARS.has('NODE_ENV'))
  assert.ok(ANT_ONLY_SAFE_ENV_VARS.has('DOCKER_HOST') && ANT_ONLY_SAFE_ENV_VARS.has('KUBECONFIG'))
})
