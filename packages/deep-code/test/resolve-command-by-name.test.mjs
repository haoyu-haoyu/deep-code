import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCommandByName } from '../src/commands/resolveCommandByName.mjs'

// loadAllCommands merges plugin commands BEFORE the built-ins, and a plugin's
// userFacingName() comes from its (display-only) frontmatter `name`. The canonical
// `name` of a plugin command is always namespaced `${pluginName}:${base}`.

test('a plugin display-name does NOT shadow a built-in (canonical wins despite order)', () => {
  // plugin listed first, mirroring the real loadAllCommands source order
  const commands = [
    { name: 'evilkit:hello', userFacingName: () => 'clear' },
    { name: 'clear' },
  ]
  assert.equal(resolveCommandByName('clear', commands)?.name, 'clear')
})

test('the namespaced plugin command is still reachable by its canonical name', () => {
  const commands = [
    { name: 'evilkit:hello', userFacingName: () => 'clear' },
    { name: 'clear' },
  ]
  assert.equal(
    resolveCommandByName('evilkit:hello', commands)?.name,
    'evilkit:hello',
  )
})

test('a non-colliding plugin display name still resolves (pass-2 fallback preserved)', () => {
  const commands = [
    { name: 'mykit:foo', userFacingName: () => 'foo' },
    { name: 'clear' },
  ]
  assert.equal(resolveCommandByName('foo', commands)?.name, 'mykit:foo')
})

test('a built-in ALIAS beats a plugin display-name collision', () => {
  const commands = [
    { name: 'plug:x', userFacingName: () => 'cfg' },
    { name: 'config', aliases: ['cfg'] },
  ]
  assert.equal(resolveCommandByName('cfg', commands)?.name, 'config')
})

test('a plugin cannot shadow security-relevant built-ins by display name', () => {
  for (const builtin of [
    'login',
    'logout',
    'permissions',
    'security-review',
    'config',
    'model',
  ]) {
    const commands = [
      { name: `evil:${builtin}`, userFacingName: () => builtin },
      { name: builtin },
    ]
    assert.equal(
      resolveCommandByName(builtin, commands)?.name,
      builtin,
      `plugin shadowed /${builtin}`,
    )
  }
})

test('order independence: built-in first also resolves canonically', () => {
  const commands = [
    { name: 'clear' },
    { name: 'evilkit:hello', userFacingName: () => 'clear' },
  ]
  assert.equal(resolveCommandByName('clear', commands)?.name, 'clear')
})

test('a command without userFacingName resolves by its own name', () => {
  assert.equal(resolveCommandByName('doctor', [{ name: 'doctor' }])?.name, 'doctor')
})

test('no match returns undefined', () => {
  assert.equal(resolveCommandByName('nope', [{ name: 'clear' }]), undefined)
  assert.equal(resolveCommandByName('', [{ name: 'clear' }]), undefined)
})

test('non-colliding lookups are unchanged (name, alias, and display all still resolve)', () => {
  const commands = [
    { name: 'a:cmd', userFacingName: () => 'acmd' },
    { name: 'help' },
    { name: 'b:cmd', aliases: ['bc'] },
  ]
  assert.equal(resolveCommandByName('a:cmd', commands)?.name, 'a:cmd')
  assert.equal(resolveCommandByName('help', commands)?.name, 'help')
  assert.equal(resolveCommandByName('bc', commands)?.name, 'b:cmd')
  // the plugin's display name still works when nothing canonical collides
  assert.equal(resolveCommandByName('acmd', commands)?.name, 'a:cmd')
})
