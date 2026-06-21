import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isTrustedLeaderControlMessage } from '../src/hooks/isTrustedLeaderControlMessage.mjs'

// The canonical team-lead identity (mirrors TEAM_LEAD_NAME in
// src/utils/swarm/constants.ts — the caller owns the SSOT and passes it in).
const LEADER = 'team-lead'

test('THE FIX: the exact team-lead sender is trusted', () => {
  assert.equal(isTrustedLeaderControlMessage('team-lead', LEADER), true)
})

test('a worker sender is rejected (the forged-escalation case)', () => {
  assert.equal(isTrustedLeaderControlMessage('worker-2', LEADER), false)
  assert.equal(isTrustedLeaderControlMessage('teammate-1', LEADER), false)
})

test('no prefix / suffix match — case-sensitive, exact only', () => {
  // a sender that merely contains or extends the leader name is NOT the leader
  assert.equal(isTrustedLeaderControlMessage('team-lead-x', LEADER), false)
  assert.equal(isTrustedLeaderControlMessage('x-team-lead', LEADER), false)
  assert.equal(isTrustedLeaderControlMessage('Team-Lead', LEADER), false)
  assert.equal(isTrustedLeaderControlMessage('team-lead ', LEADER), false)
  assert.equal(isTrustedLeaderControlMessage(' team-lead', LEADER), false)
})

test('empty / missing / non-string sender is rejected', () => {
  assert.equal(isTrustedLeaderControlMessage('', LEADER), false)
  assert.equal(isTrustedLeaderControlMessage(undefined, LEADER), false)
  assert.equal(isTrustedLeaderControlMessage(null, LEADER), false)
  assert.equal(isTrustedLeaderControlMessage(42, LEADER), false)
  assert.equal(isTrustedLeaderControlMessage({ from: 'team-lead' }, LEADER), false)
})

test('a missing / empty leaderName never trusts (fail-closed)', () => {
  // defends against a degenerate caller: an empty canonical name must NOT make
  // an empty/any sender trusted
  assert.equal(isTrustedLeaderControlMessage('', ''), false)
  assert.equal(isTrustedLeaderControlMessage('team-lead', ''), false)
  assert.equal(isTrustedLeaderControlMessage('team-lead', undefined), false)
})

// Permission control-plane provenance contract (the same predicate gates the
// worker-side permission_response / sandbox_permission_response sinks, which
// approve a pending tool use and apply attacker-supplied permission_updates).
test('CONTRACT: a permission_response is trusted only from the team-lead', () => {
  // the leader's response (envelope from === 'team-lead') is accepted
  assert.equal(isTrustedLeaderControlMessage('team-lead', 'team-lead'), true)
  // a worker-forged / self-forged response is rejected regardless of any
  // request_id match it may carry
  assert.equal(isTrustedLeaderControlMessage('worker-7', 'team-lead'), false)
  assert.equal(isTrustedLeaderControlMessage('self', 'team-lead'), false)
})
