import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideInterruptAction } from '../src/tools/BashTool/shellInterruptDecision.mjs'

const base = {
  aborted: true,
  reason: 'interrupt',
  interruptBackgroundingStarted: false,
  isBackgroundTasksDisabled: false,
}

test('a fresh interrupt backgrounds the running command', () => {
  assert.equal(decideInterruptAction(base), 'background')
})

test('a fresh interrupt with background tasks disabled kills the child', () => {
  assert.equal(
    decideInterruptAction({ ...base, isBackgroundTasksDisabled: true }),
    'kill',
  )
})

test('no action when not aborted', () => {
  assert.equal(decideInterruptAction({ ...base, aborted: false }), 'none')
})

test('no action for a non-interrupt abort reason (e.g. a hard cancel)', () => {
  assert.equal(decideInterruptAction({ ...base, reason: 'cancel' }), 'none')
  assert.equal(decideInterruptAction({ ...base, reason: undefined }), 'none')
  assert.equal(decideInterruptAction({ ...base, reason: 'kill' }), 'none')
})

test('no action once backgrounding has already started (latched, no re-entry)', () => {
  assert.equal(
    decideInterruptAction({ ...base, interruptBackgroundingStarted: true }),
    'none',
  )
  // even with bg disabled, an already-handled interrupt does not re-kill
  assert.equal(
    decideInterruptAction({
      ...base,
      interruptBackgroundingStarted: true,
      isBackgroundTasksDisabled: true,
    }),
    'none',
  )
})
