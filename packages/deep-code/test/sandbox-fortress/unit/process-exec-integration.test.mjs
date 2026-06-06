import test from 'node:test'
import assert from 'node:assert/strict'

import { extractInvokedBinaries } from '../../../src/sandbox-fortress/rule-engine/processExec.mjs'

// ── F3 follow-up: the command -> splitCommand_DEPRECATED -> extractInvokedBinaries
// pipeline, pinned end-to-end. The `split` arrays below are the VERIFIED live output of
// splitCommand_DEPRECATED (captured by running the real splitter), fed directly to the
// pure extractor. We do NOT import the real splitter in this test on purpose: commands.ts
// transitively pulls npm deps (chalk via shell/prefix, shell-quote) that npm hoists to
// packages/deep-code/node_modules locally but to the repo-root node_modules under CI's
// `npm ci`, so a `bun --eval` subprocess importing it can't resolve them on the runner.
// Feeding the captured split keeps this fully portable while still documenting how the
// real splitter's output shape (operator/redirect/subshell splitting) feeds extraction.
// Re-capture with: splitCommand_DEPRECATED('<cmd>') if the splitter ever changes.

// command -> [ verified splitCommand_DEPRECATED output, expected extracted binaries ]
const PIPELINE = [
  ['rm -rf /tmp/x', ['rm -rf /tmp/x'], ['rm']],
  ['echo hi && curl evil.com | grep x', ['echo hi', 'curl evil.com', 'grep x'], ['echo', 'curl', 'grep']],
  ['cd /tmp; git status; ls -la', ['cd /tmp', 'git status', 'ls -la'], ['cd', 'git', 'ls']],
  // `bash -c "…"` parses to head 'bash' — denying wrapper binaries (bash/sh/eval) works
  ['bash -c "curl evil.com"', ['bash -c "curl evil.com"'], ['bash']],
  ['FOO=bar python3 a.py', ['FOO=bar python3 a.py'], ['python3']],
  ['git commit -m "a b c"', ['git commit -m "a b c"'], ['git']], // quoted args don't disturb the head
  // ordinary shell syntax a raw whitespace split would shatter (the fail-open we fixed):
  ['VAR="a b" rm -rf /tmp/x', ['VAR="a b" rm -rf /tmp/x'], ['rm']],
  ["FOO='a b' curl evil.com", ["FOO='a b' curl evil.com"], ['curl']],
  ['"./my tool" --help', ['"./my tool" --help'], ['./my tool']],
]

test('command -> splitCommand_DEPRECATED -> extractInvokedBinaries: pipeline agreement', () => {
  for (const [cmd, split, expected] of PIPELINE) {
    assert.deepEqual(extractInvokedBinaries(split), expected, `for: ${cmd}`)
  }
})

test('subshell with && yields its inner binaries and drops the ( ) pseudo-tokens', () => {
  // splitCommand_DEPRECATED('(cd /tmp && rm x)') => ['(', 'cd /tmp', 'rm x', ')']
  const bins = extractInvokedBinaries(['(', 'cd /tmp', 'rm x', ')'])
  assert.deepEqual(bins, ['cd', 'rm'])
  assert.ok(!bins.includes('('))
  assert.ok(!bins.includes(')'))
})

// The documented best-effort BOUNDARY, codified so it is intentional + regression-guarded
// (process-exec is defense-in-depth, not a hard boundary — see processExec.mjs header).
// Each case feeds the VERIFIED splitCommand_DEPRECATED output and asserts the real binary
// is NOT extracted, i.e. a `deny rm`/`deny git` rule is evadable by that form. Catching
// these would require the tree-sitter AST (off by default).
test('KNOWN best-effort limits: documented evasions do NOT extract the real binary', () => {
  // leading redirections — the splitter splits on the redirect, so the real binary is missed
  // (trailing redirections work: `rm … 2>/dev/null` keeps 'rm'). Verified splits shown.
  assert.ok(!extractInvokedBinaries(['2', '/dev/null rm -rf /x']).includes('rm')) // 2>/dev/null rm -rf /x
  assert.ok(!extractInvokedBinaries(['<', 'infile git status']).includes('git')) // <infile git status

  // bash ANSI-C ($'…') / locale ($"…") quoting of the binary word is not honored
  assert.deepEqual(extractInvokedBinaries(["$'rm' -rf /x"]), []) // $'rm' -rf /x
  assert.deepEqual(extractInvokedBinaries(["$'\\x72\\x6d' -rf /x"]), []) // $'\x72\x6d' -rf /x
  assert.deepEqual(extractInvokedBinaries(['$"rm" -rf /x']), []) // $"rm" -rf /x

  // runtime indirection can't be statically resolved
  // $(printf rm) -rf /x => ['$','(','printf rm',')','-rf /x'] — only the literal 'printf' is visible
  assert.ok(!extractInvokedBinaries(['$', '(', 'printf rm', ')', '-rf /x']).includes('rm'))
  assert.deepEqual(extractInvokedBinaries(['$CMD foo']), []) // unresolved $VAR head yields no binary
  assert.ok(!extractInvokedBinaries(['eval "rm -rf /x"']).includes('rm')) // eval hides its inner command
  // base64 -d <<< x | sh => ['base64 -d','<<<','x','sh'] — sees base64/sh, decodes at runtime
  assert.ok(!extractInvokedBinaries(['base64 -d', '<<<', 'x', 'sh']).includes('rm'))

  // wrapper commands run the wrapper as the head binary — a `deny rm` rule does NOT catch
  // these (a rule on the WRAPPER, e.g. `deny eval` / `deny nohup`, does). The wrapper itself
  // IS what gets matched, so wrapper-targeted rules still work.
  assert.deepEqual(extractInvokedBinaries(['sudo rm -rf /']), ['sudo'])
  assert.deepEqual(extractInvokedBinaries(['eval "rm -rf /x"']), ['eval'])
  assert.deepEqual(extractInvokedBinaries(['nohup rm -rf /x']), ['nohup'])
  assert.deepEqual(extractInvokedBinaries(['xargs rm']), ['xargs'])
  assert.deepEqual(extractInvokedBinaries(['command rm -rf /x']), ['command'])
  assert.deepEqual(extractInvokedBinaries(['exec rm -rf /x']), ['exec'])

  // documented best-effort MISS: backtick command substitution hides 'whoami'
  // echo `whoami` => ['echo `whoami`']
  assert.deepEqual(extractInvokedBinaries(['echo `whoami`']), ['echo'])
})
