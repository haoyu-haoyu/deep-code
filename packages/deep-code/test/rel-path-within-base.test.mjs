import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod/v4/index.js'

import { relPathWithinBase } from '../src/utils/plugins/relPathWithinBase.mjs'

test('legit relative component paths are within base', () => {
  for (const p of [
    './commands/foo.md',
    './skills/bar',
    './.claude-plugin/plugin.json',
    './a/b/c.md',
    './a/./b', // a single-dot segment is fine
    './hooks.json',
  ]) {
    assert.equal(relPathWithinBase(p), true, p)
  }
})

test('THE FIX: a ".." traversal escapes base and is rejected', () => {
  for (const p of [
    './../../../home/me/.ssh/id_rsa',
    './..',
    './a/../../x',
    './commands/../../../etc/passwd',
  ]) {
    assert.equal(relPathWithinBase(p), false, p)
  }
})

test('a backslash-smuggled ".." segment is rejected', () => {
  assert.equal(relPathWithinBase('.\\..\\..\\x'), false)
  assert.equal(relPathWithinBase('./a\\..\\b'), false)
})

test('a null byte is rejected', () => {
  assert.equal(relPathWithinBase('./a' + String.fromCharCode(0) + '/b'), false)
})

test('a ".."-containing FILENAME (not a segment) is allowed', () => {
  // '..foo' / 'a..b' are not the '..' parent segment
  assert.equal(relPathWithinBase('./a..b/c'), true)
  assert.equal(relPathWithinBase('./..foo'), true)
})

test('non-string input is rejected', () => {
  assert.equal(relPathWithinBase(undefined), false)
  assert.equal(relPathWithinBase(null), false)
  assert.equal(relPathWithinBase(42), false)
})

// MIRROR of the schemas.ts composition. The whole fix depends on zod v4's
// `.refine()` returning a ZodString so the refine SURVIVES the downstream
// `.endsWith()` / union chaining (in zod v3, `.refine()` returns a ZodEffects and
// `RelativePath().endsWith('.json')` would drop/break the refine — re-opening
// containment while the leaf test above still passes green). This mirror re-creates
// the exact derivations and asserts traversal stays rejected through the chain.
const M_RelativePath = z.string().startsWith('./').refine(relPathWithinBase)
const M_RelativeJSONPath = M_RelativePath.endsWith('.json')
const M_RelativeMarkdownPath = M_RelativePath.endsWith('.md')
const M_RelativeCommandPath = z.union([M_RelativeMarkdownPath, M_RelativePath])
const M_McpbPath = z.union([
  M_RelativePath.refine(p => p.endsWith('.mcpb') || p.endsWith('.dxt')),
  z.string().url(),
])

test('refine survives .endsWith()/union chaining: derived schemas reject traversal', () => {
  for (const schema of [
    M_RelativePath,
    M_RelativeJSONPath,
    M_RelativeMarkdownPath,
    M_RelativeCommandPath,
    M_McpbPath,
  ]) {
    assert.equal(schema.safeParse('./../../etc/passwd').success, false)
    assert.equal(schema.safeParse('./..\\evil').success, false)
  }
})

test('refine still accepts legit derived paths (no false reject)', () => {
  assert.equal(M_RelativeJSONPath.safeParse('./hooks.json').success, true)
  assert.equal(M_RelativeMarkdownPath.safeParse('./commands/x.md').success, true)
  assert.equal(M_RelativeCommandPath.safeParse('./skills/foo').success, true)
  assert.equal(M_RelativeCommandPath.safeParse('./a..b/c.md').success, true)
  assert.equal(M_McpbPath.safeParse('./bundle.mcpb').success, true)
  // the McpbPath URL arm is unaffected by the RelativePath refine
  assert.equal(M_McpbPath.safeParse('https://example.com/x.mcpb').success, true)
})
