import assert from 'node:assert/strict'
import { test } from 'node:test'

import { escapeForDiff, unescapeFromDiff } from '../src/utils/escapeForDiff.mjs'

const LEAD = String.fromCharCode(0xe000)
const AMPERSAND_TOKEN = '<<:AMPERSAND_TOKEN:>>'
const DOLLAR_TOKEN = '<<:DOLLAR_TOKEN:>>'

test('normal & and $ round-trip and are absent from the escaped form', () => {
  for (const s of ['a & b', 'price $5 & $6', '$&$1', 'plain', '', '&', '$', '&&$$']) {
    const esc = escapeForDiff(s)
    assert.doesNotMatch(esc, /[&$]/, `escaped form must contain no & or $: ${JSON.stringify(s)}`)
    assert.equal(unescapeFromDiff(esc), s, `round-trip ${JSON.stringify(s)}`)
  }
})

test('the collision bug: content containing the old sentinels round-trips (was folded to &/$)', () => {
  const s = `const AMPERSAND_TOKEN = '${AMPERSAND_TOKEN}'\nconst x = ${DOLLAR_TOKEN}`
  assert.equal(unescapeFromDiff(escapeForDiff(s)), s)
  // the bare sentinels alone
  assert.equal(unescapeFromDiff(escapeForDiff(AMPERSAND_TOKEN)), AMPERSAND_TOKEN)
  assert.equal(unescapeFromDiff(escapeForDiff(DOLLAR_TOKEN)), DOLLAR_TOKEN)
})

test('content already containing the escape lead round-trips (lead escaped first)', () => {
  for (const s of [LEAD, LEAD + LEAD, LEAD + 'A', LEAD + 'D', 'x' + LEAD + 'y', LEAD + '&' + LEAD + '$']) {
    assert.equal(unescapeFromDiff(escapeForDiff(s)), s, `lead round-trip ${JSON.stringify(s)}`)
  }
})

test('bijection fuzz over a pool of & $ lead A D < > : _ and letters', () => {
  const pool = ['&', '$', LEAD, 'A', 'D', '<', '>', ':', '_', 'a', 'b', '\n', ' ', '\\']
  let seed = 0x2f6e2b1
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let t = 0; t < 200000; t++) {
    const n = Math.floor(rnd() * 12)
    let s = ''
    for (let i = 0; i < n; i++) s += pool[Math.floor(rnd() * pool.length)]
    const esc = escapeForDiff(s)
    assert.equal(unescapeFromDiff(esc), s)
    assert.doesNotMatch(esc, /[&$]/)
  }
})

test('escaped form has no & or $ even for adversarial sentinel-adjacent content', () => {
  const s = `${AMPERSAND_TOKEN}${DOLLAR_TOKEN}&$${LEAD}`
  assert.doesNotMatch(escapeForDiff(s), /[&$]/)
  assert.equal(unescapeFromDiff(escapeForDiff(s)), s)
})
