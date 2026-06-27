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

const m = (rule, tool) => toolWideRuleNameMatches(rule, tool, mcpInfoFromString)

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
