import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseKeystroke, parseChord } from '../src/keybindings/keystrokeParse.mjs'

const ks = (o = {}) => ({
  key: '', ctrl: false, alt: false, shift: false, meta: false, super: false, ...o,
})

test('THE FIX: spaces around "+" do not split a single keystroke into a chord', () => {
  // "ctrl + shift + k" must parse identically to "ctrl+shift+k": ONE keystroke.
  const tight = parseChord('ctrl+shift+k')
  const spaced = parseChord('ctrl + shift + k')
  assert.deepEqual(spaced, tight)
  assert.equal(spaced.length, 1)
  assert.deepEqual(spaced[0], ks({ key: 'k', ctrl: true, shift: true }))
})

test('mixed spacing around "+" is normalized', () => {
  assert.deepEqual(parseChord('ctrl+shift + k'), parseChord('ctrl+shift+k'))
  assert.deepEqual(parseChord('ctrl +shift+k'), parseChord('ctrl+shift+k'))
})

test('genuine chord steps (space-separated) are still TWO keystrokes', () => {
  const chord = parseChord('ctrl+k ctrl+s')
  assert.equal(chord.length, 2)
  assert.deepEqual(chord[0], ks({ key: 'k', ctrl: true }))
  assert.deepEqual(chord[1], ks({ key: 's', ctrl: true }))
})

test('chord steps with spaces around "+" AND a step separator both work', () => {
  const chord = parseChord('ctrl + k  ctrl + s')
  assert.equal(chord.length, 2)
  assert.deepEqual(chord[0], ks({ key: 'k', ctrl: true }))
  assert.deepEqual(chord[1], ks({ key: 's', ctrl: true }))
})

test('parseKeystroke trims each part (no embedded-space key names)', () => {
  assert.deepEqual(parseKeystroke(' shift '), ks({ shift: true }))
  assert.deepEqual(parseKeystroke(' ctrl '), ks({ ctrl: true }))
  assert.deepEqual(parseKeystroke(' a '), ks({ key: 'a' }))
  // all spacing variants agree
  assert.deepEqual(parseKeystroke('shift'), parseKeystroke(' shift'))
  assert.deepEqual(parseKeystroke('shift'), parseKeystroke('shift '))
})

test('the lone-space binding is preserved (space key, not a separator)', () => {
  assert.deepEqual(parseChord(' '), [ks({ key: ' ' })])
})

test('modifier aliases and special keys unchanged', () => {
  assert.deepEqual(parseKeystroke('opt+esc'), ks({ key: 'escape', alt: true }))
  assert.deepEqual(parseKeystroke('cmd+return'), ks({ key: 'enter', super: true }))
  assert.deepEqual(parseKeystroke('meta+↑'), ks({ key: 'up', meta: true }))
  assert.deepEqual(parseKeystroke('space'), ks({ key: ' ' }))
})

test('a plain key and a single modifier parse as before (no regression)', () => {
  assert.deepEqual(parseChord('a'), [ks({ key: 'a' })])
  assert.deepEqual(parseChord('ctrl+c'), [ks({ key: 'c', ctrl: true })])
})
