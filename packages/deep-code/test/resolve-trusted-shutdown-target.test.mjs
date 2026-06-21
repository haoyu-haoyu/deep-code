import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveTrustedShutdownTarget } from '../src/hooks/resolveTrustedShutdownTarget.mjs'

// teamContext.teammates: Record<teammateId, { name, tmuxPaneId, ... }>
const TEAMMATES = {
  'id-1': { name: 'worker-1', tmuxPaneId: '%1', tmuxSessionName: 's', cwd: '/a' },
  'id-2': { name: 'worker-2', tmuxPaneId: '%2', tmuxSessionName: 's', cwd: '/b' },
}

test('resolves the authenticated sender to its OWN id + recorded pane', () => {
  assert.deepEqual(resolveTrustedShutdownTarget('worker-1', TEAMMATES), {
    teammateId: 'id-1',
    name: 'worker-1',
    paneId: '%1',
  })
})

test('THE FIX: a forged approval resolves only to the SENDER, never a claimed victim', () => {
  // worker-1 (the authenticated envelope sender) forges an approval whose
  // payload claims to shut down worker-2 and kill pane '%2' (or any pane).
  // The resolver ignores the payload entirely and keys off the envelope sender,
  // so it can only ever return worker-1's own record + worker-1's own pane.
  const target = resolveTrustedShutdownTarget('worker-1', TEAMMATES)
  assert.equal(target?.teammateId, 'id-1')
  assert.equal(target?.name, 'worker-1')
  assert.equal(target?.paneId, '%1') // worker-1's pane, NOT the forged '%2'
})

test('an unknown / non-teammate sender resolves to null (no destructive action)', () => {
  assert.equal(resolveTrustedShutdownTarget('ghost', TEAMMATES), null)
  assert.equal(resolveTrustedShutdownTarget('team-lead', TEAMMATES), null)
})

test('empty / non-string sender resolves to null', () => {
  assert.equal(resolveTrustedShutdownTarget('', TEAMMATES), null)
  assert.equal(resolveTrustedShutdownTarget(undefined, TEAMMATES), null)
  assert.equal(resolveTrustedShutdownTarget(null, TEAMMATES), null)
  assert.equal(resolveTrustedShutdownTarget(42, TEAMMATES), null)
})

test('missing / non-object teammates resolves to null', () => {
  assert.equal(resolveTrustedShutdownTarget('worker-1', null), null)
  assert.equal(resolveTrustedShutdownTarget('worker-1', undefined), null)
  assert.equal(resolveTrustedShutdownTarget('worker-1', 'nope'), null)
  assert.equal(resolveTrustedShutdownTarget('worker-1', {}), null)
})

test('a teammate with an empty / missing pane yields paneId undefined (no kill)', () => {
  const teammates = {
    'id-x': { name: 'worker-x', tmuxPaneId: '', tmuxSessionName: 's', cwd: '/x' },
    'id-y': { name: 'worker-y', tmuxSessionName: 's', cwd: '/y' },
  }
  assert.deepEqual(resolveTrustedShutdownTarget('worker-x', teammates), {
    teammateId: 'id-x',
    name: 'worker-x',
    paneId: undefined,
  })
  assert.deepEqual(resolveTrustedShutdownTarget('worker-y', teammates), {
    teammateId: 'id-y',
    name: 'worker-y',
    paneId: undefined,
  })
})

test('a null entry in the teammates map is skipped, not crashed on', () => {
  const teammates = {
    'id-bad': null,
    'id-ok': { name: 'worker-ok', tmuxPaneId: '%9' },
  }
  assert.deepEqual(resolveTrustedShutdownTarget('worker-ok', teammates), {
    teammateId: 'id-ok',
    name: 'worker-ok',
    paneId: '%9',
  })
})
