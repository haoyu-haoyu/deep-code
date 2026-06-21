import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectSandboxRipgrepConfig } from '../src/sandbox-fortress/adapter/ripgrepConfigSource.mjs'

const FALLBACK = { command: '/bundled/rg', args: ['--json'], argv0: 'rg' }
const POLICY = { command: '/admin/rg', args: ['--policy'] }
const USER = { command: '/home/me/rg', args: ['--user'] }

test('a managed (policySettings) ripgrep wins', () => {
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: POLICY, userRipgrep: USER, fallback: FALLBACK }),
    POLICY,
  )
})

test('a user-global ripgrep is honored when no managed one is set', () => {
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: undefined, userRipgrep: USER, fallback: FALLBACK }),
    USER,
  )
})

test('THE FIX: with NO trusted (policy/user) ripgrep, the bundled rg is used', () => {
  // project/local are never passed in — a workspace ripgrep can never win
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: undefined, userRipgrep: undefined, fallback: FALLBACK }),
    FALLBACK,
  )
})

test('a malformed trusted ripgrep (empty / non-string command) falls back to the bundled rg', () => {
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: { command: '' }, userRipgrep: undefined, fallback: FALLBACK }),
    FALLBACK,
  )
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: { args: ['x'] }, userRipgrep: undefined, fallback: FALLBACK }),
    FALLBACK,
  )
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: { command: 123 }, userRipgrep: undefined, fallback: FALLBACK }),
    FALLBACK,
  )
})

test('a malformed managed ripgrep falls through to a valid user one', () => {
  assert.equal(
    selectSandboxRipgrepConfig({ policyRipgrep: { command: '' }, userRipgrep: USER, fallback: FALLBACK }),
    USER,
  )
})
