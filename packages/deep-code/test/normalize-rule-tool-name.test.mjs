import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeRuleToolName } from '../src/utils/permissions/normalizeRuleToolName.mjs'

// Mirrors the real LEGACY_TOOL_NAME_ALIASES shape: legacy -> canonical.
const aliases = {
  Task: 'Agent',
  KillShell: 'TaskStop',
  BashOutputTool: 'TaskOutput',
}

test('a clean tool name passes through unchanged', () => {
  assert.equal(normalizeRuleToolName('Bash', aliases), 'Bash')
  assert.equal(normalizeRuleToolName('Read', aliases), 'Read')
})

test('THE FIX: a leading space no longer makes the rule inert', () => {
  // " Bash" used to be stored verbatim; the matcher compares
  // rule.toolName === tool.name, so " Bash" !== "Bash" -> deny never fires.
  assert.equal(normalizeRuleToolName(' Bash', aliases), 'Bash')
})

test('THE FIX: a trailing space (e.g. "Bash (rm:*)") is trimmed too', () => {
  assert.equal(normalizeRuleToolName('Bash ', aliases), 'Bash')
  assert.equal(normalizeRuleToolName('  Bash  ', aliases), 'Bash')
})

test('trims tabs and newlines, not just spaces', () => {
  assert.equal(normalizeRuleToolName('\tBash\n', aliases), 'Bash')
})

test('a legacy alias still resolves after trimming', () => {
  assert.equal(normalizeRuleToolName('Task', aliases), 'Agent')
  // The asymmetry that motivated the fix: a padded legacy name now also resolves.
  assert.equal(normalizeRuleToolName('  Task  ', aliases), 'Agent')
  assert.equal(normalizeRuleToolName('KillShell', aliases), 'TaskStop')
})

test('a whitespace-only name collapses to "" (so empty-name handling rejects it)', () => {
  assert.equal(normalizeRuleToolName('   ', aliases), '')
  assert.equal(normalizeRuleToolName('', aliases), '')
})

test('internal whitespace is preserved — only the surrounding padding is removed', () => {
  // MCP tool names and rule contents never reach here with internal spaces, but
  // be explicit that trim() only touches the ends.
  assert.equal(normalizeRuleToolName(' mcp__srv__do ', aliases), 'mcp__srv__do')
  assert.equal(normalizeRuleToolName('a b', aliases), 'a b')
})

test('a name that is also a legacy key but padded resolves to the canonical', () => {
  assert.equal(normalizeRuleToolName('BashOutputTool ', aliases), 'TaskOutput')
})
