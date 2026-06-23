import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripTailFocusMarker } from '../src/hooks/stripPasteFocusMarker.mjs'

const ESC = String.fromCharCode(27)
// The exact pre-fix strip, as a differential oracle.
const oldStrip = s => s.replace(/\[I$/, '').replace(/\[O$/, '')

test('THE FIX (no dangling ESC): a real focus marker at the tail is removed whole', () => {
  assert.equal(stripTailFocusMarker('hello' + ESC + '[I'), 'hello')
  assert.equal(stripTailFocusMarker('hello' + ESC + '[O'), 'hello')
  // the result contains no leftover ESC
  assert.ok(!stripTailFocusMarker('hi' + ESC + '[I').includes(ESC))
  // the old strip left a dangling ESC
  assert.equal(oldStrip('hello' + ESC + '[I'), 'hello' + ESC)
  assert.ok(oldStrip('hi' + ESC + '[I').includes(ESC))
})

test('THE FIX (no over-strip): legitimate text ending in "[I" / "[O" is preserved', () => {
  assert.equal(stripTailFocusMarker('value = arr[I'), 'value = arr[I')
  assert.equal(stripTailFocusMarker('config[O'), 'config[O')
  // the old strip silently deleted the trailing two chars
  assert.equal(oldStrip('value = arr[I'), 'value = arr')
  assert.equal(oldStrip('config[O'), 'config')
})

test('a focus marker NOT at the tail is left for the downstream stripAnsi', () => {
  // mid-paste markers keep their ESC and are removed later by stripAnsi
  assert.equal(stripTailFocusMarker('hel' + ESC + '[I' + 'lo'), 'hel' + ESC + '[I' + 'lo')
})

test('plain pasted text is unchanged', () => {
  assert.equal(stripTailFocusMarker('hello world'), 'hello world')
  assert.equal(stripTailFocusMarker(''), '')
  assert.equal(stripTailFocusMarker('/Users/me/a.png'), '/Users/me/a.png')
})

test('only a single trailing marker is removed (one focus event per paste tail)', () => {
  // ESC[I ESC[O at the tail -> only the last marker is stripped (matches the
  // single-replace semantics; a real tail carries at most one focus event)
  assert.equal(stripTailFocusMarker('x' + ESC + '[I' + ESC + '[O'), 'x' + ESC + '[I')
})

test('a bare ESC at the tail (no [I/[O) is not touched here', () => {
  assert.equal(stripTailFocusMarker('hi' + ESC), 'hi' + ESC)
})
