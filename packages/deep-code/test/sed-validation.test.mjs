import test from 'node:test'
import assert from 'node:assert/strict'

import {
  containsDangerousOperations,
  isPrintCommand,
  validateFlagsAgainstAllowlist,
} from '../src/tools/BashTool/sedValidationCore.mjs'

// ── sed read-only-mode validation core (allow/deny for `sed` under read-only) ─
// SECURITY-critical: checkSedConstraints (sedValidation.ts) gates `sed` so a
// read-only / dangerous-op guard can't be bypassed into file-WRITE (w/W) or
// shell-EXEC (e/E). The defense-in-depth DENYLIST `containsDangerousOperations`
// and the strict print allowlist `isPrintCommand` are the pure heart of that.
// A gap = a read-only-mode bypass to arbitrary write/exec. This logic had ZERO
// unit coverage (trapped in a .ts that imports a bun-tainted shell parser).
// Behavior is a verbatim extraction — these tests pin the current contract.

// --- containsDangerousOperations: MUST flag (true = dangerous, blocked) ------

test('dangerous: w/W file-write in every address form', () => {
  for (const e of [
    'w /tmp/x', 'W /tmp/x',
    '1w /tmp/x', '1 w /tmp/x',
    '$w /tmp/x', '$ w /tmp/x',
    '/pat/w /tmp/x', '/pat/Iw /tmp/x',
    '1,10w /tmp/x', '1,$w /tmp/x',
    '/a/,/b/w /tmp/x',
  ]) {
    assert.equal(containsDangerousOperations(e), true, `should flag write: ${e}`)
  }
})

test('dangerous: e/E shell-exec in every address form', () => {
  for (const e of [
    'e id', '1e', '1 e', '$e', '$ e',
    '/pat/e', '1,10e', '1,$e', '/a/,/b/e',
  ]) {
    assert.equal(containsDangerousOperations(e), true, `should flag exec: ${e}`)
  }
})

test('dangerous: substitution / y commands carrying w or e flags', () => {
  for (const e of [
    's/old/new/w file', 's/old/new/gw file', 's/a/b/W file',
    's/old/new/e', 's/old/new/ge', 's/a/b/E',
    's#a#b#w file', // non-/ delimiter write
    'y/abc/def/;w file', 'y|a|b|;e cmd',
  ]) {
    assert.equal(containsDangerousOperations(e), true, `should flag flagged-subst: ${e}`)
  }
})

test('dangerous: Unicode homoglyphs / non-ASCII (smuggled w/e lookalikes)', () => {
  assert.equal(containsDangerousOperations('ｗ /tmp/x'), true) // fullwidth w U+FF57
  assert.equal(containsDangerousOperations('1ᴡ file'), true) // small-cap W U+1D21
  assert.equal(containsDangerousOperations('s/a/b/' + '́'), true) // combining accent
})

test('dangerous: structural tricks — braces, newlines, comments, negation', () => {
  assert.equal(containsDangerousOperations('{w file}'), true) // block
  assert.equal(containsDangerousOperations('p\nw file'), true) // newline
  assert.equal(containsDangerousOperations('#!/bin/sh'), true) // comment (# not after s)
  assert.equal(containsDangerousOperations('!p'), true) // leading negation
  assert.equal(containsDangerousOperations('/pat/!d'), true) // negation after pattern
  assert.equal(containsDangerousOperations('1,10!d'), true)
})

test('dangerous: GNU address extensions — step, leading/offset comma', () => {
  assert.equal(containsDangerousOperations('1~2p'), true) // step address
  assert.equal(containsDangerousOperations(',~3p'), true)
  assert.equal(containsDangerousOperations(',p'), true) // bare leading comma (1,$ shorthand)
  assert.equal(containsDangerousOperations('1,+2p'), true) // offset address
  assert.equal(containsDangerousOperations(',+3w x'), true)
})

test('dangerous: backslash / alternate-delimiter tricks', () => {
  assert.equal(containsDangerousOperations('s\\a\\b\\'), true) // s + backslash delim
  assert.equal(containsDangerousOperations('\\|pat|w file'), true) // \| alt delimiter
  assert.equal(containsDangerousOperations('\\#pat#d'), true)
  assert.equal(containsDangerousOperations('/\\/etc\\/x/w f'), true) // escaped-slash then w
  assert.equal(containsDangerousOperations('/pattern w file'), true) // malformed slash + w
})

test('dangerous: malformed substitutions that escape the safe shape', () => {
  assert.equal(containsDangerousOperations('s/foobaroutput.txt'), true) // missing delimiters
  assert.equal(containsDangerousOperations('s/foo/bar//w'), true) // extra delimiter + w
})

// --- containsDangerousOperations: MUST allow (false = safe) -------------------

test('safe: empty, plain substitutions, and plain print/delete addresses', () => {
  assert.equal(containsDangerousOperations(''), false)
  assert.equal(containsDangerousOperations('   '), false)
  for (const e of ['s/foo/bar/', 's/foo/bar/g', 's/a/b/gi', 's/a/b/I', 'p', '1p', '1,5p', '1,$p', '5d', '1,10d']) {
    assert.equal(containsDangerousOperations(e), false, `should be safe: ${e}`)
  }
})

// --- isPrintCommand: strict print allowlist ----------------------------------

test('isPrintCommand: only p / Np / N,Mp', () => {
  for (const ok of ['p', '1p', '123p', '1,5p', '10,200p']) {
    assert.equal(isPrintCommand(ok), true, `print: ${ok}`)
  }
  for (const bad of ['', 'w file', 'e cmd', 'd', '1,5d', 'g', 's/a/b/', '1p;2p', 'P', '1,p', ',5p', '1pq']) {
    assert.equal(isPrintCommand(bad), false, `not print: ${bad}`)
  }
})

// --- validateFlagsAgainstAllowlist: single, long, and combined flags ---------

test('validateFlagsAgainstAllowlist: combined flags checked per character', () => {
  const allowed = ['-n', '-E', '-r', '-z', '--quiet']
  assert.equal(validateFlagsAgainstAllowlist(['-n'], allowed), true)
  assert.equal(validateFlagsAgainstAllowlist(['-nE'], allowed), true) // combined, all allowed
  assert.equal(validateFlagsAgainstAllowlist(['--quiet'], allowed), true) // long form
  assert.equal(validateFlagsAgainstAllowlist(['-nz', '-E'], allowed), true)
  assert.equal(validateFlagsAgainstAllowlist(['-nx'], allowed), false) // x not allowed (combined)
  assert.equal(validateFlagsAgainstAllowlist(['-w'], allowed), false) // single not allowed
  assert.equal(validateFlagsAgainstAllowlist(['--in-place'], allowed), false) // long not allowed
})
