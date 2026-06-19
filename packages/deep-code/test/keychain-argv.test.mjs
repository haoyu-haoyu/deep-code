import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildKeychainFindArgs,
  buildKeychainDeleteArgs,
  buildKeychainAddInteractiveLine,
} from '../src/utils/secureStorage/keychainArgs.mjs'

// Reference model of `security -i`'s interactive tokenizer (Apple's argv_from_string):
// `\` escapes the next char, an unescaped `"` toggles quoting, unquoted whitespace
// separates tokens. Validated against the real `security` CLI in the survey research.
function tokenizeSecurityLine(line) {
  const tokens = []
  let cur = ''
  let inQuote = false
  let started = false
  let esc = false
  for (const ch of line) {
    if (esc) {
      cur += ch
      esc = false
      started = true
    } else if (ch === '\\') {
      esc = true
      started = true
    } else if (ch === '"') {
      inQuote = !inQuote
      started = true
    } else if (!inQuote && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      if (started) {
        tokens.push(cur)
        cur = ''
        started = false
      }
    } else {
      cur += ch
      started = true
    }
  }
  if (started) tokens.push(cur)
  return tokens
}
const accountOf = line => {
  const t = tokenizeSecurityLine(line)
  return t[t.indexOf('-a') + 1]
}

// The macOS keychain read()/delete() build their `security` invocation as an
// argv ARRAY (shell=false) instead of interpolating $USER into a shell command
// STRING. A username (or service-name fragment) with a shell-significant char
// must stay a SINGLE literal token — not split into extra args, and never
// shell-expanded — so it can't break quoting or inject a command.

test('find/delete argv place username + service name as discrete literal tokens', () => {
  assert.deepEqual(buildKeychainFindArgs('alice', 'deepcode.credentials'), [
    'find-generic-password',
    '-a',
    'alice',
    '-w',
    '-s',
    'deepcode.credentials',
  ])
  assert.deepEqual(buildKeychainDeleteArgs('alice', 'deepcode.credentials'), [
    'delete-generic-password',
    '-a',
    'alice',
    '-s',
    'deepcode.credentials',
  ])
})

test('a username with shell-significant characters stays ONE literal arg (no split, no expansion)', () => {
  const hostile = 'a b"; rm -rf ~ && $(whoami)`id`'
  const find = buildKeychainFindArgs(hostile, 'svc')
  // the username occupies exactly the slot after -a, verbatim
  assert.equal(find[find.indexOf('-a') + 1], hostile)
  // and it is exactly one element — not split on spaces/quotes
  assert.equal(find.filter(a => a === hostile).length, 1)
  assert.equal(find.length, 6)

  const del = buildKeychainDeleteArgs(hostile, 'svc"; reboot')
  assert.equal(del[del.indexOf('-a') + 1], hostile)
  assert.equal(del[del.indexOf('-s') + 1], 'svc"; reboot')
  assert.equal(del.length, 5)
})

// --- the `security -i` stdin line (update()): username must not inject flags ---

test('a benign username produces the exact legacy line (byte-identical happy path)', () => {
  for (const u of ['alice', 'jane.doe-1', 'user_2']) {
    const svc = 'Claude Code-abc123'
    const hex = '7b2261223a317d'
    assert.equal(
      buildKeychainAddInteractiveLine(u, svc, hex),
      `add-generic-password -U -a "${u}" -s "${svc}" -X "${hex}"\n`,
      `legacy bytes for ${u}`,
    )
  }
})

test('a crafted username cannot inject a flag (the bug): the -a value stays one token', () => {
  const hex = '6162'
  // each of these would, UN-escaped, close the -a value and inject `-A` (allow ANY
  // app to read the credential) / `-s` (mis-target) / `-X` (overwrite bytes).
  for (const u of [
    'evil" -A -l x',
    'a" -A',
    'x" -s OTHER -X deadbeef',
    'a"b',
    'a\\c',
    'a"b\\c',
    'a\\"b',
    'plain',
  ]) {
    const line = buildKeychainAddInteractiveLine(u, 'svc', hex)
    assert.notEqual(line, null, `${u} should be representable`)
    const tokens = tokenizeSecurityLine(line)
    // the account is exactly the original username, one token
    assert.equal(accountOf(line), u, `account round-trips for ${JSON.stringify(u)}`)
    // no injected flag appeared between -a's value and -s
    const aIdx = tokens.indexOf('-a')
    const sIdx = tokens.indexOf('-s')
    assert.equal(sIdx - aIdx, 2, `no extra token injected for ${JSON.stringify(u)}`)
    assert.ok(!tokens.includes('-A'), `no -A injected for ${JSON.stringify(u)}`)
  }
})

test('a newline/CR/NUL value returns null (fall back to the safe argv branch)', () => {
  const hex = '6162'
  for (const bad of ['a\nb', 'a\rb', 'a\0b']) {
    assert.equal(buildKeychainAddInteractiveLine(bad, 'svc', hex), null, `username ${JSON.stringify(bad)}`)
    assert.equal(buildKeychainAddInteractiveLine('alice', bad, hex), null, `service ${JSON.stringify(bad)}`)
  }
  // a non-hex value (defensive) also routes to argv
  assert.equal(buildKeychainAddInteractiveLine('alice', 'svc', 'NOT-HEX'), null)
})

test('fuzz: any representable username round-trips through the tokenizer to itself', () => {
  let s = 0x2545f491 >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 0x100000000)
  const alphabet = ['a', 'Z', '0', ' ', '"', '\\', '-', '.', '$', '`', ';', '/', '\t', 'é', '👤']
  for (let iter = 0; iter < 20000; iter++) {
    const n = (rnd() * 8) | 0
    let u = ''
    for (let k = 0; k < n; k++) u += alphabet[(rnd() * alphabet.length) | 0]
    const line = buildKeychainAddInteractiveLine(u, 'svc', '6162')
    // no \n/\r/\0 in this alphabet, so it is always representable
    assert.notEqual(line, null, `iter ${iter}`)
    assert.equal(accountOf(line), u, `iter ${iter}: ${JSON.stringify(u)} round-trips`)
  }
})
