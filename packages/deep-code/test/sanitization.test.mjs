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

// --- deep-input DoS: a hostile/pathological MCP tools/list inputSchema --------
// A deeply-nested value used to recurse on the NATIVE call stack and throw
// RangeError; in fetchToolsForClient that throw is caught and the WHOLE server's
// tools are dropped (return []). JSON.parse is iterative and survives this depth,
// so the sanitizer was the weakest link. The iterative (heap-stack) walk must
// handle arbitrary depth without throwing, while still sanitizing every leaf.
test('recursivelySanitizeUnicode: deeply-nested input does NOT overflow the stack', () => {
  const zw = cp(0x200b)
  // 40k of object nesting — well past the ~5k native-call-stack limit, modeling a
  // malicious server whose JSON.parse-able wire payload reaches the sanitizer.
  let objDeep = { leaf: 'deep' + zw + 'val' }
  for (let i = 0; i < 40000; i++) objDeep = { ['n' + zw]: objDeep }
  let resultObj
  assert.doesNotThrow(() => {
    resultObj = recursivelySanitizeUnicode(objDeep)
  })
  // descend and confirm the deep leaf string was still sanitized + the key cleaned
  let cur = resultObj
  for (let i = 0; i < 40000; i++) cur = cur.n
  assert.equal(cur.leaf, 'deepval')

  // same for deep array nesting — and confirm the innermost string IS sanitized
  let arrDeep = ['x' + zw + 'y']
  for (let i = 0; i < 40000; i++) arrDeep = [arrDeep]
  let resultArr
  assert.doesNotThrow(() => {
    resultArr = recursivelySanitizeUnicode(arrDeep)
  })
  let curArr = resultArr
  for (let i = 0; i < 40000; i++) curArr = curArr[0]
  assert.equal(curArr[0], 'xy')
})

// --- behavior-identity edge cases the iterative rewrite must preserve ----------
test('recursivelySanitizeUnicode: preserves object key INSERTION ORDER', () => {
  const out = recursivelySanitizeUnicode({ b: 1, a: 2, c: 3 })
  assert.deepEqual(Object.keys(out), ['b', 'a', 'c'])
})

test('recursivelySanitizeUnicode: preserves ARRAY HOLES (sparse arrays) like .map', () => {
  const sparse = ['a']
  sparse[3] = 'b' // indices 1,2 are holes
  const out = recursivelySanitizeUnicode(sparse)
  assert.equal(out.length, 4)
  assert.equal(1 in out, false)
  assert.equal(2 in out, false)
  assert.deepEqual([out[0], out[3]], ['a', 'b'])
})

test('recursivelySanitizeUnicode: keys colliding after sanitization keep first position, last value wins', () => {
  const zw = cp(0x200b)
  // 'a​' and 'a' both sanitize to 'a'; the recursive impl assigned in
  // iteration order so the LAST source value wins at the FIRST key's position.
  const out = recursivelySanitizeUnicode({ ['a' + zw]: 'first', a: 'second' })
  assert.deepEqual(Object.keys(out), ['a'])
  assert.equal(out.a, 'second')
})

test('recursivelySanitizeUnicode: a __proto__ data key (JSON.parse can produce one) assigns via live [[Set]] like the recursion', () => {
  const zw = cp(0x200b)
  // JSON.parse yields an OWN "__proto__" data property; the sanitizer re-assigns
  // each key with a live `obj[key] = …`, so an object-valued __proto__ sets the
  // prototype (no own "__proto__" key) — characterizing parity with the previous
  // recursive `sanitized[key] = val` walk, the reachable malicious-MCP data case.
  const single = recursivelySanitizeUnicode(JSON.parse('{"__proto__": {"a": 1}}'))
  assert.deepEqual(Object.keys(single), [])
  assert.equal(Object.getPrototypeOf(single).a, 1)
  // colliding __proto__ keys (object then primitive) — last (primitive) is a
  // setter no-op, so the object-valued first assignment determines the prototype.
  const collide = recursivelySanitizeUnicode(
    JSON.parse('{"__proto__": {"a": 1}, "__proto__' + zw + '": 0}'),
  )
  assert.deepEqual(Object.keys(collide), [])
  assert.equal(Object.getPrototypeOf(collide).a, 1)
  // never mutates the global prototype
  assert.equal({}.a, undefined)
})
