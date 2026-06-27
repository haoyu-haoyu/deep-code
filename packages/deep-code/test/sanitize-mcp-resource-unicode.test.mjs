import { test } from 'node:test'
import assert from 'node:assert/strict'

import { recursivelySanitizeUnicode } from '../src/utils/sanitization.mjs'

// Contract test for the #682 fix: fetchResourcesForClient now routes the
// server-supplied resource list through recursivelySanitizeUnicode (parity with
// fetchToolsForClient / fetchCommandsForClient). A resource's uri/name/
// description is attacker-controlled and reaches the model as a tool result, so
// hidden/format Unicode (ASCII smuggling, bidi overrides, zero-width, PUA) must
// be stripped. This asserts the util applied to the resource SHAPE does that.

// Hidden code units that must never survive:
const ZWSP = '​' // zero-width space
const RLO = '‮' // right-to-left override (bidi)
const BOM = '﻿'
const PUA = '' // private use area
const TAG = '󠁁' // U+E0041 TAG LATIN CAPITAL A (ASCII-smuggling tag char)

const hidden = ZWSP + RLO + BOM + PUA + TAG

test('strips hidden Unicode from a single resource object', () => {
  const resource = {
    uri: `file://repo/${ZWSP}secret${RLO}`,
    name: `read${PUA}me`,
    description: `A normal description${TAG}`,
    mimeType: 'text/plain',
  }
  const out = recursivelySanitizeUnicode(resource)
  assert.equal(out.uri, 'file://repo/secret')
  assert.equal(out.name, 'readme')
  assert.equal(out.description, 'A normal description')
  assert.equal(out.mimeType, 'text/plain')
})

test('strips hidden Unicode across an array of resources (the real shape)', () => {
  const resources = [
    { uri: `a${hidden}`, name: 'one', description: 'first' },
    { uri: 'b', name: `two${hidden}`, description: `second${hidden}` },
  ]
  const out = recursivelySanitizeUnicode(resources)
  assert.ok(Array.isArray(out), 'array shape preserved')
  assert.equal(out[0].uri, 'a')
  assert.equal(out[1].name, 'two')
  assert.equal(out[1].description, 'second')
})

test('the sanitized text contains none of the hidden code units', () => {
  const out = recursivelySanitizeUnicode({ name: `x${hidden}y` })
  for (const ch of [ZWSP, RLO, BOM, PUA]) {
    assert.ok(!out.name.includes(ch), `must strip U+${ch.charCodeAt(0).toString(16)}`)
  }
  // The TAG char (astral) must be gone too — no lone surrogate left behind.
  assert.equal(out.name, 'xy')
})

test('legit ASCII and normal Unicode text is preserved', () => {
  const resource = {
    uri: 'https://example.com/path?q=1&r=2',
    name: 'Café résumé 日本語 — emoji 🎨 ok',
    description: 'Plain text with punctuation: (parens), [brackets], {braces}.',
  }
  const out = recursivelySanitizeUnicode(resource)
  // NFKC leaves these unchanged; nothing legit should be dropped.
  assert.equal(out.uri, 'https://example.com/path?q=1&r=2')
  assert.equal(out.name, 'Café résumé 日本語 — emoji 🎨 ok')
  assert.equal(out.description, 'Plain text with punctuation: (parens), [brackets], {braces}.')
})
