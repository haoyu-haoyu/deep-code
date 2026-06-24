import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeKeyForComparison } from '../src/keybindings/normalizeKeyForComparison.mjs'

test('THE FIX: alt and meta normalize to the SAME canonical form (they are one runtime modifier)', () => {
  assert.equal(
    normalizeKeyForComparison('alt+k'),
    normalizeKeyForComparison('meta+k'),
  )
  assert.equal(normalizeKeyForComparison('meta+k'), 'alt+k')
  assert.equal(normalizeKeyForComparison('alt+k'), 'alt+k')
  // opt/option already collapsed to alt; meta now joins them
  assert.equal(normalizeKeyForComparison('opt+k'), 'alt+k')
  assert.equal(normalizeKeyForComparison('option+k'), 'alt+k')
})

test('cmd/command stays a DISTINCT modifier (not collapsed into alt)', () => {
  assert.equal(normalizeKeyForComparison('cmd+k'), 'cmd+k')
  assert.equal(normalizeKeyForComparison('command+k'), 'cmd+k')
  assert.notEqual(normalizeKeyForComparison('cmd+k'), normalizeKeyForComparison('alt+k'))
})

test('ctrl/control + shift normalize as before (no regression)', () => {
  assert.equal(normalizeKeyForComparison('control+k'), 'ctrl+k')
  assert.equal(normalizeKeyForComparison('Ctrl+Shift+K'), 'ctrl+shift+k')
  // modifier order is canonicalized (sorted)
  assert.equal(
    normalizeKeyForComparison('shift+ctrl+k'),
    normalizeKeyForComparison('ctrl+shift+k'),
  )
})

test('chords are normalized per-step (not collapsed to the last key)', () => {
  assert.equal(normalizeKeyForComparison('ctrl+x ctrl+b'), 'ctrl+x ctrl+b')
  // alt/meta collapse applies within each step
  assert.equal(
    normalizeKeyForComparison('alt+x meta+b'),
    normalizeKeyForComparison('meta+x alt+b'),
  )
})

test('a plain key and case-folding behave as before', () => {
  assert.equal(normalizeKeyForComparison('K'), 'k')
  assert.equal(normalizeKeyForComparison('Escape'), 'escape')
})
