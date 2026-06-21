import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveProjectMcpServerStatus } from '../src/services/mcp/projectMcpApproval.mjs'

const base = {
  targetName: 'evil',
  disabledNamesMerged: [],
  enabledNamesTrusted: [],
  enableAllTrusted: false,
}

test('a disabled server is rejected (deny wins, from merged settings)', () => {
  assert.equal(
    resolveProjectMcpServerStatus({ ...base, disabledNamesMerged: ['evil'] }),
    'rejected',
  )
})

test('disable beats enable (deny precedence)', () => {
  assert.equal(
    resolveProjectMcpServerStatus({
      ...base,
      disabledNamesMerged: ['evil'],
      enabledNamesTrusted: ['evil'],
      enableAllTrusted: true,
    }),
    'rejected',
  )
})

test('a trusted-source named-enable approves', () => {
  assert.equal(
    resolveProjectMcpServerStatus({ ...base, enabledNamesTrusted: ['evil'] }),
    'approved',
  )
})

test('a trusted-source enableAll approves any server', () => {
  assert.equal(
    resolveProjectMcpServerStatus({ ...base, enableAllTrusted: true }),
    'approved',
  )
})

test('THE FIX: with no trusted enable, an unknown server is pending (not approved)', () => {
  // The workspace projectSettings enable signal is never passed in, so a repo
  // self-approving its own server yields pending, not approved → the per-server
  // approval dialog is shown (caller falls through to bypass/non-interactive).
  assert.equal(resolveProjectMcpServerStatus(base), 'pending')
})

test('a different trusted-enabled server does not approve the target', () => {
  assert.equal(
    resolveProjectMcpServerStatus({
      ...base,
      enabledNamesTrusted: ['some-other-server'],
    }),
    'pending',
  )
})
