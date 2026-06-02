import test from 'node:test'
import assert from 'node:assert/strict'

import {
  partiallySanitizeUnicode,
  recursivelySanitizeUnicode,
} from '../src/utils/sanitization.mjs'

// ── Unicode hidden-character sanitization (ASCII smuggling / prompt injection) ─
// HackerOne #3086545: invisible Unicode (Tag chars, format controls, PUA,
// noncharacters) can hide instructions that the model reads but a human can't
// see. This logic strips them + NFKC-normalizes. It guards MCP tool inputs and
// outputs (services/mcp/client.ts) and had ZERO direct unit coverage before this
// (it was trapped in a .ts that node --test can't load). Behavior is a verbatim
// extraction — these tests pin the current contract.

const cp = (...codepoints) => String.fromCodePoint(...codepoints)

// --- the headline attack: Unicode TAG characters (U+E0000–E007F) -------------

test('partiallySanitizeUnicode: strips Unicode TAG chars (the #3086545 smuggling vector)', () => {
  // "delete everything" hidden in tag chars between visible words.
  const hidden = cp(0xe0064, 0xe0065, 0xe006c) // tag 'd','e','l'
  assert.equal(partiallySanitizeUnicode('run' + hidden + 'safe'), 'runsafe')
  // a full tag-char run vanishes entirely
  const tagRun = Array.from('inject', c => cp(0xe0000 + c.charCodeAt(0))).join('')
  assert.equal(partiallySanitizeUnicode('hello' + tagRun), 'hello')
})

// --- Cf / Co / Cn category stripping -----------------------------------------

test('partiallySanitizeUnicode: strips zero-width / directional / isolate / BOM controls', () => {
  assert.equal(partiallySanitizeUnicode('a' + cp(0x200b) + 'b'), 'ab') // zero-width space
  assert.equal(partiallySanitizeUnicode('a' + cp(0x200d) + 'b'), 'ab') // zero-width joiner
  assert.equal(partiallySanitizeUnicode('a' + cp(0x200e) + 'b'), 'ab') // LTR mark
  assert.equal(partiallySanitizeUnicode('a' + cp(0x202e) + 'b'), 'ab') // RTL override
  assert.equal(partiallySanitizeUnicode('a' + cp(0x2066) + 'b' + cp(0x2069)), 'ab') // isolates
  assert.equal(partiallySanitizeUnicode('a' + cp(0xfeff) + 'b'), 'ab') // BOM / ZWNBSP
})

test('partiallySanitizeUnicode: strips Private Use Area and noncharacters', () => {
  assert.equal(partiallySanitizeUnicode('a' + cp(0xe000) + cp(0xf8ff) + 'b'), 'ab') // BMP PUA
  assert.equal(partiallySanitizeUnicode('a' + cp(0xfffe) + 'b'), 'ab') // noncharacter (Cn)
})

// --- NFKC normalization ------------------------------------------------------

test('partiallySanitizeUnicode: NFKC normalizes compatibility forms', () => {
  assert.equal(partiallySanitizeUnicode('ﬁle'), 'file') // ﬁ ligature -> fi
  assert.equal(partiallySanitizeUnicode('ＡＢＣ'), 'ABC') // fullwidth -> ASCII
  assert.equal(partiallySanitizeUnicode('e' + cp(0x0301)), cp(0x00e9)) // e + combining acute -> é
})

// --- preserves legitimate content (no over-stripping) ------------------------

test('partiallySanitizeUnicode: preserves ASCII, CJK, accents, and ordinary symbols', () => {
  for (const ok of ['hello world', 'café', '日本語のテキスト', 'a+b=c & d|e', '🙂', 'Ω≈ç√∫']) {
    assert.equal(partiallySanitizeUnicode(ok), ok.normalize('NFKC'), `should preserve: ${ok}`)
  }
  assert.equal(partiallySanitizeUnicode(''), '')
})

// --- convergence / idempotence (the MAX_ITERATIONS guard) --------------------

test('partiallySanitizeUnicode: is idempotent and does not throw on normal input', () => {
  const messy = 'a' + cp(0x200b) + 'ﬁ' + cp(0xe0041) + 'B'
  const once = partiallySanitizeUnicode(messy)
  assert.equal(partiallySanitizeUnicode(once), once) // fixed point reached
  assert.doesNotThrow(() => partiallySanitizeUnicode('x'.repeat(5000) + cp(0x200b)))
})

// --- recursivelySanitizeUnicode ----------------------------------------------

test('recursivelySanitizeUnicode: strings, arrays, nested objects, and object KEYS', () => {
  const zw = cp(0x200b)
  assert.equal(recursivelySanitizeUnicode('a' + zw + 'b'), 'ab')
  assert.deepEqual(recursivelySanitizeUnicode(['a' + zw, 'c' + zw]), ['a', 'c'])
  // keys are sanitized too (a hidden char in a key can smuggle structure)
  assert.deepEqual(
    recursivelySanitizeUnicode({ ['k' + zw]: 'v' + zw, nested: { ['x' + zw]: ['y' + zw] } }),
    { k: 'v', nested: { x: ['y'] } },
  )
})

test('recursivelySanitizeUnicode: leaves non-string primitives unchanged', () => {
  assert.equal(recursivelySanitizeUnicode(42), 42)
  assert.equal(recursivelySanitizeUnicode(true), true)
  assert.equal(recursivelySanitizeUnicode(null), null)
  assert.equal(recursivelySanitizeUnicode(undefined), undefined)
  assert.deepEqual(recursivelySanitizeUnicode([1, 'a', null, false]), [1, 'a', null, false])
})
