import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IF_CONDITION_TOOL_EVENTS,
  eventSupportsIfCondition,
} from '../src/utils/hookIfConditionEvents.mjs'

test('all five tool-input-bearing events support an `if` condition', () => {
  for (const e of [
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionRequest',
    'PermissionDenied',
  ]) {
    assert.equal(eventSupportsIfCondition(e), true, `${e} should support if`)
  }
})

test('regression: PermissionDenied is included (it was the silently-dropped one)', () => {
  // PermissionDenied shares the tool_name matchQuery branch and its input
  // carries tool_input, so an `if` on a PermissionDenied hook must be honored.
  assert.equal(eventSupportsIfCondition('PermissionDenied'), true)
  assert.ok(IF_CONDITION_TOOL_EVENTS.has('PermissionDenied'))
})

test('non-tool events do NOT support an `if` condition', () => {
  // These resolve matchQuery to source/reason/trigger/etc., not tool_name, and
  // their input carries no tool_input — an `if` matcher must stay undefined.
  for (const e of [
    'SessionStart',
    'SessionEnd',
    'Setup',
    'PreCompact',
    'PostCompact',
    'Notification',
    'Stop',
    'StopFailure',
    'UserPromptSubmit',
  ]) {
    assert.equal(eventSupportsIfCondition(e), false, `${e} should NOT support if`)
  }
})

test('unknown / empty / non-string event names are safely excluded', () => {
  assert.equal(eventSupportsIfCondition('Nonexistent'), false)
  assert.equal(eventSupportsIfCondition(''), false)
  assert.equal(eventSupportsIfCondition(undefined), false)
})

test('the canonical set is exactly the five tool-input-bearing events', () => {
  assert.deepEqual(
    [...IF_CONDITION_TOOL_EVENTS].sort(),
    [
      'PermissionDenied',
      'PermissionRequest',
      'PostToolUse',
      'PostToolUseFailure',
      'PreToolUse',
    ],
  )
})
