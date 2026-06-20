import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMcpResourceMentionSuppressed } from '../src/utils/mcpResourceMentionGate.mjs'

// An @server:uri MCP-resource mention is read silently during attachment
// expansion (before the turn, no permission prompt). Like the @-file path, it
// must DROP the mention when the user configured a deny OR ask rule on
// ReadMcpResourceTool — otherwise an un-prompted read (incl. one auto-triggered
// by an untrusted skill body) bypasses the rule. There is no workingDir analog
// for an MCP resource, so ANY matched rule suppresses.

const RULE = { ruleValue: { toolName: 'ReadMcpResourceTool' } } // a resolved PermissionRule shape

test('a deny rule suppresses the mention', () => {
  assert.equal(isMcpResourceMentionSuppressed({ denyRule: RULE, askRule: null }), true)
})

test('an ask rule ALSO suppresses (no prompt is possible during attachment expansion)', () => {
  assert.equal(isMcpResourceMentionSuppressed({ denyRule: null, askRule: RULE }), true)
})

test('deny + ask both present → suppress', () => {
  assert.equal(isMcpResourceMentionSuppressed({ denyRule: RULE, askRule: RULE }), true)
})

test('no rule (the default) → NOT suppressed (read proceeds, no regression)', () => {
  assert.equal(isMcpResourceMentionSuppressed({ denyRule: null, askRule: null }), false)
  // missing keys / no-arg are also "not suppressed" (safe default for the call shape)
  assert.equal(isMcpResourceMentionSuppressed({}), false)
  assert.equal(isMcpResourceMentionSuppressed(), false)
})

test('undefined (not just null) rule values are treated as absent', () => {
  assert.equal(isMcpResourceMentionSuppressed({ denyRule: undefined, askRule: undefined }), false)
})

// DRIFT GUARD: the .ts gate (attachments.ts isMcpResourceReadSuppressed) matches
// the rule by the hardcoded tool name 'ReadMcpResourceTool'. If the tool renames
// its `name`, the gate silently stops matching the user's rule. Pin them.
test("the gate's tool name matches ReadMcpResourceTool's actual name (drift guard)", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const toolSrc = readFileSync(
    resolve(here, '..', 'src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts'),
    'utf8',
  )
  assert.match(toolSrc, /name:\s*'ReadMcpResourceTool'/, 'tool name literal present')
  const gateSrc = readFileSync(resolve(here, '..', 'src/utils/attachments.ts'), 'utf8')
  assert.match(
    gateSrc,
    /name:\s*'ReadMcpResourceTool'\s*\}\s*as const/,
    "attachments.ts gate must reference the tool name 'ReadMcpResourceTool'",
  )
})
