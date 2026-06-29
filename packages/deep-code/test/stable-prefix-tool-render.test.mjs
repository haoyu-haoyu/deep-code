import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'

import { createDeepCodeStablePrefix } from '../src/deepcode/stable-prefix.mjs'
import { clearDeepSeekToolManifestCache } from '../src/services/providers/deepseek-tool-manifest-cache.mjs'

// A provider that supports the stable-prefix cache (so createDeepCodeStablePrefix
// actually computes a prefixHash rather than the disabled-path stub).
const provider = { supports: cap => cap === 'stable_prefix_cache' }

// A tool whose prompt() (the description renderer) DRIFTS — returns a different
// string on every call. Real tools do this: their description is built from
// mutable session state (an agent list that changes after a subagent registers,
// an MCP server connecting, a feature-gate flip). The wire renders tools through
// the memoized cachedToolToDeepSeekFunctionSchema, which LOCKS the description at
// first render, so the wire bytes never drift.
function driftingTool() {
  let calls = 0
  return {
    name: 'Task',
    inputJSONSchema: { type: 'object', properties: {}, required: [] },
    prompt: async () => `description render ${++calls}`,
  }
}

beforeEach(() => clearDeepSeekToolManifestCache())

test('a mid-session tool-description drift does NOT change the prefix hash', async () => {
  const tools = [driftingTool()]
  const p1 = await createDeepCodeStablePrefix({ systemPrompt: ['sys'], tools, provider })
  const p2 = await createDeepCodeStablePrefix({ systemPrompt: ['sys'], tools, provider })
  // The description is rendered once (locked) and reused, so the recorded
  // fingerprint stays stable turn-over-turn — matching the byte-locked wire.
  assert.equal(p1.prefixHash, p2.prefixHash)
  assert.equal(p1.componentHashes.tools, p2.componentHashes.tools)
  // both builds carry the FIRST (locked) description, not a drifted one
  assert.equal(p1.stableTools[0].description, 'description render 1')
  assert.equal(p2.stableTools[0].description, 'description render 1')
})

test('the prefix hash still tracks a genuine tool change (different params → different render)', async () => {
  // A tool whose PARAMETERS differ keys to a different cache slot, so it renders
  // (and hashes) distinctly — the diagnostic still detects a real change.
  const a = await createDeepCodeStablePrefix({
    systemPrompt: ['sys'],
    tools: [{ name: 'Task', inputJSONSchema: { type: 'object', properties: { a: { type: 'string' } } }, prompt: async () => 'd' }],
    provider,
  })
  const b = await createDeepCodeStablePrefix({
    systemPrompt: ['sys'],
    tools: [{ name: 'Task', inputJSONSchema: { type: 'object', properties: { b: { type: 'string' } } }, prompt: async () => 'd' }],
    provider,
  })
  assert.notEqual(a.prefixHash, b.prefixHash)
})

test('clearing the manifest cache (a session/compaction reset) re-renders the description', async () => {
  const tool = driftingTool()
  const a = await createDeepCodeStablePrefix({ systemPrompt: ['sys'], tools: [tool], provider })
  clearDeepSeekToolManifestCache()
  const b = await createDeepCodeStablePrefix({ systemPrompt: ['sys'], tools: [tool], provider })
  assert.equal(a.stableTools[0].description, 'description render 1')
  assert.equal(b.stableTools[0].description, 'description render 2')
  assert.notEqual(a.prefixHash, b.prefixHash)
})
