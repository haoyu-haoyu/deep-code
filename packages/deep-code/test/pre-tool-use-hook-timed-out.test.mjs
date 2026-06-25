import { test } from 'node:test'
import assert from 'node:assert/strict'

import { preToolUseHookTimedOut } from '../src/utils/hooks/preToolUseHookTimedOut.mjs'

test('THE FIX: a PreToolUse hook that TIMED OUT (combined aborted, outer NOT) fails closed', () => {
  // combined signal aborted by the per-hook timeout; outer/user signal not aborted
  assert.equal(preToolUseHookTimedOut('PreToolUse', true, false), true)
})

test('a genuine OUTER cancellation (user aborted the turn) does NOT force a deny', () => {
  // both aborted -> the outer cancel propagated, not a lone timeout
  assert.equal(preToolUseHookTimedOut('PreToolUse', true, true), false)
})

test('a hook that did NOT abort is never a timeout-deny', () => {
  assert.equal(preToolUseHookTimedOut('PreToolUse', false, false), false)
  assert.equal(preToolUseHookTimedOut('PreToolUse', false, true), false)
})

test('only PreToolUse fails closed on timeout; other events keep cancellation', () => {
  for (const ev of ['PostToolUse', 'Stop', 'SubagentStop', 'UserPromptSubmit', 'SessionStart', 'Notification', 'PreCompact']) {
    assert.equal(preToolUseHookTimedOut(ev, true, false), false, `${ev} must not block on timeout`)
  }
})

test('truthiness coercion: undefined aborted flags behave as false', () => {
  assert.equal(preToolUseHookTimedOut('PreToolUse', undefined, false), false)
  assert.equal(preToolUseHookTimedOut('PreToolUse', true, undefined), true)
})
