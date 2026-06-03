import test from 'node:test'
import assert from 'node:assert/strict'

import { isCommandSafeViaFlagParsingCore } from '../src/tools/BashTool/readOnlyFlagParsingCore.mjs'

// ── isCommandSafeViaFlagParsing core (read-only auto-approval guard) ──────────
// SECURITY: this decides whether a command is safe to auto-approve as read-only.
// Its job is to defend the parser DIFFERENTIAL: shell-quote keeps `$VAR` literal
// in tokens, but bash expands it at runtime — a documented file-write / RCE
// vector. It also blocks brace-expansion obfuscation, git ls-remote URL exfil,
// and shell operators. This was untestable under node (the .ts imports a
// bun-tainted shell parser + a ~1000-line allowlist). Extracted as a DI'd core;
// here the impure deps are injected so the guards are tested in isolation.
// Behavior verified identical to the real wired function via bun separately.

// A space-splitting parser is enough for these tests: shell-quote (and the real
// parser callback) preserve `$VAR` as a literal token, which split(' ') also does.
const splitParser = cmd => ({ success: true, tokens: cmd.split(' ').filter(Boolean) })

function deps(over = {}) {
  return {
    parseShellCommand: over.parseShellCommand ?? splitParser,
    getAllowlist: over.getAllowlist ?? (() => ({
      'git diff': { safeFlags: {} },
      'git log': { safeFlags: {} },
      'git ls-remote': { safeFlags: {} },
      rg: { safeFlags: {} },
      ps: { safeFlags: {} },
      xargs: { safeFlags: {} },
    })),
    validateFlags: over.validateFlags ?? (() => true),
    safeXargsTargetCommands: over.safeXargsTargetCommands ?? ['grep'],
  }
}
const safe = (cmd, over) => isCommandSafeViaFlagParsingCore(cmd, deps(over))

// --- the headline defense: parser-differential `$` rejection -----------------

test('rejects ANY token containing $ (the runtime parser-differential)', () => {
  // (1) $VAR-prefix defeats validateFlags startsWith('-') → arbitrary file write
  assert.equal(safe('git diff $Z--output=/tmp/pwned'), false)
  // (2) $VAR-prefix → RCE via rg --pre
  assert.equal(safe('rg . $Z--pre=bash FILE'), false)
  // (3) $VAR-infix defeats a callback regex (ps ax$Ze → ps axe)
  assert.equal(safe('ps ax$Ze'), false)
  // the $ guard runs BEFORE validateFlags: even a permissive validateFlags can't save it
  assert.equal(safe('git diff $X', { validateFlags: () => true }), false)
})

// --- brace-expansion obfuscation guard ---------------------------------------

test('rejects brace expansion ({ with , or ..), allows legit braces (stash@{0})', () => {
  assert.equal(safe('git diff {@{0},--output=/x}'), false) // { + ,
  assert.equal(safe('git log {1..5}'), false) // { + ..
  // legit single-brace forms (no , / ..) must NOT be rejected by the brace guard
  assert.equal(safe('git log stash@{0}'), true) // git ref
  assert.equal(safe('git diff prefix-{}-suffix'), true) // xargs-style placeholder
})

// --- git ls-remote URL / data-exfil guard ------------------------------------

test('git ls-remote rejects URLs / SSH specs / $ but allows a bare remote name', () => {
  assert.equal(safe('git ls-remote https://evil.com/x'), false)
  assert.equal(safe('git ls-remote git@host:user/repo.git'), false) // @ and :
  assert.equal(safe('git ls-remote host:repo'), false) // :
  assert.equal(safe('git ls-remote $REMOTE'), false) // $
  assert.equal(safe('git ls-remote origin'), true) // bare local remote name
})

// --- operator / glob token handling ------------------------------------------

test('rejects commands that parse to shell operators', () => {
  const withOperator = () => ({ success: true, tokens: ['git', 'diff', { op: '&&' }] })
  assert.equal(safe('git diff x && evil', { parseShellCommand: withOperator }), false)
})

test('glob tokens are reduced to their pattern (treated as plain args)', () => {
  const globParser = () => ({ success: true, tokens: ['rg', 'pat', { op: 'glob', pattern: '*.txt' }] })
  assert.equal(safe('rg pat *.txt', { parseShellCommand: globParser }), true)
})

test('a parse failure or empty command is not safe', () => {
  assert.equal(safe('git diff', { parseShellCommand: () => ({ success: false }) }), false)
  assert.equal(safe('', { parseShellCommand: () => ({ success: true, tokens: [] }) }), false)
})

// --- allowlist matching ------------------------------------------------------

test('only allowlisted commands pass; multi-word commands match by prefix', () => {
  assert.equal(safe('git diff HEAD'), true)
  assert.equal(safe('rm -rf /'), false) // not in allowlist
  assert.equal(safe('git'), false) // 'git' alone matches no multi-word entry
  assert.equal(safe('git push origin', { getAllowlist: () => ({ 'git diff': { safeFlags: {} } }) }), false)
})

// --- validateFlags / regex / backtick / callback wiring ----------------------

test('validateFlags result gates the decision', () => {
  assert.equal(safe('git diff x', { validateFlags: () => true }), true)
  assert.equal(safe('git diff x', { validateFlags: () => false }), false)
})

test('config.regex must match; without a regex a backtick is rejected', () => {
  // a config regex that does NOT match the command → unsafe
  assert.equal(
    safe('git diff x', { getAllowlist: () => ({ 'git diff': { safeFlags: {}, regex: /NOPE/ } }) }),
    false,
  )
  // no regex + a backtick anywhere → unsafe
  assert.equal(safe('rg `whoami`', { parseShellCommand: cmd => ({ success: true, tokens: cmd.split(' ') }) }), false)
})

test('rg/grep reject embedded newlines; additionalCommandIsDangerousCallback can veto', () => {
  assert.equal(
    safe('rg pat\nfile', { parseShellCommand: () => ({ success: true, tokens: ['rg', 'pat\nfile'] }) }),
    false,
  )
  assert.equal(
    safe('ps aux', { getAllowlist: () => ({ ps: { safeFlags: {}, additionalCommandIsDangerousCallback: () => true } }) }),
    false,
  )
})

test('xargs forwards the safe-target list to validateFlags', () => {
  let received
  safe('xargs grep pat', {
    validateFlags: (_t, _c, _cfg, opts) => {
      received = opts.xargsTargetCommands
      return true
    },
  })
  assert.deepEqual(received, ['grep'])
})
