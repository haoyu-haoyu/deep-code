import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolWideRuleNameMatches } from '../src/utils/permissions/toolWideRuleNameMatches.mjs'

// Faithful reimplementation of mcpInfoFromString (mcpStringUtils.ts) for the leaf.
function mcpInfoFromString(toolString) {
  const parts = toolString.split('__')
  const [mcpPart, serverName, ...toolNameParts] = parts
  if (mcpPart !== 'mcp' || !serverName) return null
  const toolName = toolNameParts.length > 0 ? toolNameParts.join('__') : undefined
  return { serverName, toolName }
}

// Faithful core of normalizeNameForMCP (normalization.ts): non-[a-zA-Z0-9_-] -> _.
// (The claude.ai-prefix underscore-collapse is an extra step verified against the
// real function in the engine integration test; the leaf logic only needs the
// injected normalizer applied symmetrically to both sides.)
const normalizeNameForMCP = name => name.replace(/[^a-zA-Z0-9_-]/g, '_')

const m = (rule, tool) =>
  toolWideRuleNameMatches(rule, tool, mcpInfoFromString, normalizeNameForMCP)

test('direct name match (non-MCP) — unchanged from `===`', () => {
  assert.equal(m('Bash', 'Bash'), true)
  assert.equal(m('Edit', 'Edit'), true)
  assert.equal(m('Bash', 'Edit'), false)
})

test('MCP server-level rule shadows a tool-specific name', () => {
  // The bug: naive `===` returned false here, so the diagnostic missed the shadow.
  assert.equal(m('mcp__server1', 'mcp__server1__tool1'), true)
  assert.equal(m('mcp__github', 'mcp__github__create_issue'), true)
})

test('MCP server wildcard rule matches any tool of the server', () => {
  assert.equal(m('mcp__server1__*', 'mcp__server1__tool1'), true)
})

test('MCP server-level rule does NOT cross servers', () => {
  assert.equal(m('mcp__server1', 'mcp__server2__tool1'), false)
  assert.equal(m('mcp__server1__*', 'mcp__server2__tool1'), false)
})

test('a tool-specific MCP rule does not match a different tool of the same server', () => {
  // ruleInfo.toolName is a concrete name (not undefined/`*`) → only a direct match.
  assert.equal(m('mcp__server1__tool1', 'mcp__server1__tool2'), false)
  assert.equal(m('mcp__server1__tool1', 'mcp__server1__tool1'), true)
})

test('non-MCP rule vs MCP tool (and vice versa) does not match', () => {
  assert.equal(m('Bash', 'mcp__server1__tool1'), false)
  assert.equal(m('mcp__server1', 'Bash'), false)
})

test('SECURITY: a raw-named rule matches the normalized tool name (server contains a rewritten char)', () => {
  // The tool name was built with normalizeNameForMCP (`foo.bar` -> `foo_bar`),
  // but the rule is the user's raw text. Without normalizing the rule side these
  // silently fail to match -> a DENY fails open.
  const tool = 'mcp__foo_bar__danger'
  assert.equal(m('mcp__foo.bar', tool), true) // server-level
  assert.equal(m('mcp__foo.bar__*', tool), true) // wildcard
  assert.equal(m('mcp__foo.bar__danger', tool), true) // per-tool (raw)
  // space + dot, mirroring a real 'claude.ai Canva'-style server name
  assert.equal(m('mcp__claude.ai Canva', 'mcp__claude_ai_Canva__export_design'), true)
})

test('normalization does NOT cause cross-server or cross-tool over-match', () => {
  const tool = 'mcp__foo_bar__danger'
  assert.equal(m('mcp__other', tool), false) // different server
  assert.equal(m('mcp__foo.bar__other', tool), false) // same server, different tool
  // two distinct raw names that normalize the same DO match (same tool identity)
  assert.equal(m('mcp__foo_bar__danger', tool), true)
})
