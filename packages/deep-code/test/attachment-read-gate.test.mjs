import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldSuppressAttachmentRead } from '../src/utils/attachmentReadGate.mjs'

const allow = { behavior: 'allow' }
const deny = { behavior: 'deny' }
const askConfigured = { behavior: 'ask', decisionReason: { type: 'rule' } }
const askWorkingDir = { behavior: 'ask', decisionReason: { type: 'workingDir' } }

test('a hard deny is always suppressed (both sources)', () => {
  assert.equal(shouldSuppressAttachmentRead(deny, { bodySourced: false }), true)
  assert.equal(shouldSuppressAttachmentRead(deny, { bodySourced: true }), true)
})

test('an allow is never suppressed', () => {
  assert.equal(shouldSuppressAttachmentRead(allow, { bodySourced: false }), false)
  assert.equal(shouldSuppressAttachmentRead(allow, { bodySourced: true }), false)
})

test('a CONFIGURED ask (rule/fortress/UNC) is suppressed — the path cannot prompt', () => {
  assert.equal(shouldSuppressAttachmentRead(askConfigured, { bodySourced: false }), true)
  assert.equal(shouldSuppressAttachmentRead(askConfigured, { bodySourced: true }), true)
})

test('THE FIX: a default out-of-workspace ask reads for a user @-mention but is suppressed for a body @-mention', () => {
  // live user-typed @-mention -> read (preserve long-standing behavior)
  assert.equal(shouldSuppressAttachmentRead(askWorkingDir, { bodySourced: false }), false)
  // pre-written command/skill/plugin/MCP body @-mention -> suppress the out-of-workspace read
  assert.equal(shouldSuppressAttachmentRead(askWorkingDir, { bodySourced: true }), true)
})

test('default options preserve the user-typed (non-suppressed) behavior', () => {
  // omitting the options object entirely == bodySourced false
  assert.equal(shouldSuppressAttachmentRead(askWorkingDir), false)
  assert.equal(shouldSuppressAttachmentRead(deny), true)
})

test('a missing/undefined decision never throws and does not suppress', () => {
  assert.equal(shouldSuppressAttachmentRead(undefined, { bodySourced: true }), false)
  assert.equal(shouldSuppressAttachmentRead(null, { bodySourced: true }), false)
})

test('an ask with no decisionReason is treated as configured (suppressed) — fail-closed', () => {
  // a non-workingDir ask we cannot classify is suppressed rather than read silently
  assert.equal(
    shouldSuppressAttachmentRead({ behavior: 'ask' }, { bodySourced: false }),
    true,
  )
})

test('byte-identical to the old gate for the user-typed (bodySourced=false) path', () => {
  // the old isFileReadDenied: deny -> true; ask && reason!==workingDir -> true; else false
  const oldGate = d =>
    d.behavior === 'deny' ||
    (d.behavior === 'ask' && d.decisionReason?.type !== 'workingDir')
  for (const d of [allow, deny, askConfigured, askWorkingDir, { behavior: 'ask' }]) {
    assert.equal(
      shouldSuppressAttachmentRead(d, { bodySourced: false }),
      oldGate(d),
      `divergence on ${JSON.stringify(d)}`,
    )
  }
})
