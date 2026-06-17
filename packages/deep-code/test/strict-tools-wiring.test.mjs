import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDeepSeekRequest } from '../src/services/providers/deepseek.mjs'

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
