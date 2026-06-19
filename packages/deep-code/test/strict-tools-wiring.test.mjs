import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDeepSeekRequest } from '../src/services/providers/deepseek.mjs'
import { createDeepCodeStablePrefix } from '../src/deepcode/stable-prefix.mjs'
import { resolveStrictMode } from '../src/services/providers/resolveStrictMode.mjs'

// Hermetic env: base URL + key fixed, no config-dir → loadDeepSeekConfigFile
// returns null (path derived from this env does not exist).
const baseEnv = {
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_API_KEY: 'sk-test',
}
const closedTool = {
  name: 'Closed',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'string' } },
    required: ['a'],
  },
}
const optionalTool = {
  name: 'Optional',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['a'], // b optional → not safe
  },
}
const build = (env, extra = {}) =>
  buildDeepSeekRequest({ systemPrompt: [], messages: [], tools: [closedTool, optionalTool], env, ...extra })
const findTool = (req, name) => req.body.tools.find(t => t.function.name === name)
const isStrict = t => t.function.strict === true

test('default (no DEEPCODE_STRICT_TOOLS): no tool strict + base URL not /beta (byte-identity)', async () => {
  const req = await build(baseEnv)
  assert.equal(isStrict(findTool(req, 'Closed')), false)
  assert.equal(isStrict(findTool(req, 'Optional')), false)
  assert.equal('strict' in findTool(req, 'Closed').function, false)
  assert.ok(!req.url.includes('/beta'), `expected non-beta url, got ${req.url}`)
})

test("DEEPCODE_STRICT_TOOLS=all: every tool strict + base URL flips to /beta", async () => {
  const req = await build({ ...baseEnv, DEEPCODE_STRICT_TOOLS: 'all' })
  assert.equal(isStrict(findTool(req, 'Closed')), true)
  assert.equal(isStrict(findTool(req, 'Optional')), true)
  assert.ok(req.url.includes('/beta'), `expected /beta url, got ${req.url}`)
})

test("DEEPCODE_STRICT_TOOLS=safe: only the closed all-required tool is strict; /beta because >=1 strict", async () => {
  const req = await build({ ...baseEnv, DEEPCODE_STRICT_TOOLS: 'safe' })
  assert.equal(isStrict(findTool(req, 'Closed')), true)
  assert.equal(isStrict(findTool(req, 'Optional')), false)
  assert.ok(req.url.includes('/beta'))
})

test("DEEPCODE_STRICT_TOOLS=safe with ONLY optional-param tools: nothing strict, base URL stays non-beta", async () => {
  const req = await buildDeepSeekRequest({
    systemPrompt: [], messages: [], tools: [optionalTool],
    env: { ...baseEnv, DEEPCODE_STRICT_TOOLS: 'safe' },
  })
  assert.equal(isStrict(req.body.tools[0]), false)
  assert.ok(!req.url.includes('/beta'))
})

test('explicit strictTools boolean overrides env (true=all, false=off)', async () => {
  const all = await build({ ...baseEnv, DEEPCODE_STRICT_TOOLS: 'off' }, { strictTools: true })
  assert.equal(isStrict(findTool(all, 'Optional')), true)
  assert.ok(all.url.includes('/beta'))

  const off = await build({ ...baseEnv, DEEPCODE_STRICT_TOOLS: 'all' }, { strictTools: false })
  assert.equal(isStrict(findTool(off, 'Closed')), false)
  assert.ok(!off.url.includes('/beta'))
})

// --- the stable-prefix hash must render tools under the SAME strict mode the
// wire uses, or the prefix-change detector under-reports a real wire change ---

test('resolveStrictMode: boolean override wins, else env DEEPCODE_STRICT_TOOLS (default off)', () => {
  assert.equal(resolveStrictMode({ strictTools: true, env: baseEnv }), 'all')
  assert.equal(resolveStrictMode({ strictTools: false, env: { ...baseEnv, DEEPCODE_STRICT_TOOLS: 'all' } }), 'off')
  assert.equal(resolveStrictMode({ env: { ...baseEnv, DEEPCODE_STRICT_TOOLS: 'safe' } }), 'safe')
  assert.equal(resolveStrictMode({ env: { ...baseEnv, DEEPCODE_STRICT_TOOLS: 'nullable' } }), 'nullable')
  assert.equal(resolveStrictMode({ env: baseEnv }), 'off') // no env → off
})

const prefixTools = [closedTool, optionalTool]
const stableToolByName = (prefix, name) =>
  prefix.stableTools.find(t => t.name === name)

test('stable prefix renders tools FAITHFULLY: each manifest tool matches the wire render under the same strict mode', async () => {
  for (const mode of ['off', 'safe', 'all', 'nullable']) {
    const env = mode === 'off' ? baseEnv : { ...baseEnv, DEEPCODE_STRICT_TOOLS: mode }
    const req = await buildDeepSeekRequest({ systemPrompt: [], messages: [], tools: prefixTools, env })
    const prefix = await createDeepCodeStablePrefix({ tools: prefixTools, env })
    for (const name of ['Closed', 'Optional']) {
      const wire = findTool(req, name).function
      const stable = stableToolByName(prefix, name)
      assert.deepEqual(
        stable.parameters,
        wire.parameters,
        `mode=${mode} tool=${name}: manifest parameters must equal the wire-rendered parameters`,
      )
      // the manifest carries strict iff the wire marks the tool strict
      assert.equal(
        stable.strict === true,
        wire.strict === true,
        `mode=${mode} tool=${name}: strict flag must match the wire`,
      )
    }
  }
})

test('the prefix hash now FINGERPRINTS strict mode (the detector sees a toggle)', async () => {
  const off = await createDeepCodeStablePrefix({ tools: prefixTools, env: baseEnv })
  const all = await createDeepCodeStablePrefix({
    tools: prefixTools,
    env: { ...baseEnv, DEEPCODE_STRICT_TOOLS: 'all' },
  })
  // Before the fix the manifest always rendered off-mode, so these were equal and
  // a mid-session strict toggle produced status=unchanged. Now they differ.
  assert.notEqual(off.prefixHash, all.prefixHash)
  assert.notEqual(off.componentHashes.tools, all.componentHashes.tools)
})

test('off-mode byte-identity: omitted strictMode + no env === explicit off', async () => {
  // The common path (no DEEPCODE_STRICT_TOOLS) must hash exactly as before.
  const implicit = await createDeepCodeStablePrefix({ tools: prefixTools, env: baseEnv })
  const explicit = await createDeepCodeStablePrefix({ tools: prefixTools, strictMode: 'off', env: baseEnv })
  assert.equal(implicit.prefixHash, explicit.prefixHash)
  assert.equal(implicit.componentHashes.tools, explicit.componentHashes.tools)
  // and no tool carries a strict flag in off mode
  for (const t of implicit.stableTools) {
    assert.equal('strict' in t, false, `off-mode tool ${t.name} must not carry strict`)
  }
})
