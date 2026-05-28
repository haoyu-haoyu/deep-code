import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { doctorHandler } from '../src/cli/handlers/doctor.mjs'
import {
  runDoctorChecks,
  summarizeDoctorChecks,
} from '../src/cli/handlers/doctorChecks.mjs'

const OK_ENV = Object.freeze({
  DEEPCODE_CONFIG_FILE: join(tmpdir(), 'deepcode-doctor-test-missing-config.json'),
  DEEPSEEK_API_KEY: 'sk-test-doctor-key-1234567890',
  PATH: '/usr/bin',
})

test('doctorHandler --json writes structured output', async () => {
  let output = ''
  const expected = {
    checks: [
      {
        name: 'API key',
        status: 'ok',
        message: 'configured',
      },
    ],
    overall: 'ok',
  }

  const result = await doctorHandler({
    checksRunner: async () => expected,
    json: true,
    stdout: { write: chunk => { output += chunk } },
  })

  assert.deepEqual(result, expected)
  assert.deepEqual(JSON.parse(output), expected)
})

test('runDoctorChecks returns expected check shape and all-ok aggregate', async () => {
  const result = await runDoctorChecks(okCheckOptions())

  assert.equal(result.overall, 'ok')
  assert.deepEqual(
    result.checks.map(check => check.name),
    ['Provider runtime', 'API key', 'Network', 'Model', 'LSP servers'],
  )

  for (const check of result.checks) {
    assert.equal(typeof check.name, 'string')
    assert.match(check.status, /^(ok|warn|fail)$/)
    assert.equal(typeof check.message, 'string')
    if (check.hint !== undefined) assert.equal(typeof check.hint, 'string')
  }
})

test('missing API key returns a failing check', async () => {
  const result = await runDoctorChecks(okCheckOptions({
    env: {
      DEEPCODE_CONFIG_FILE: join(tmpdir(), 'deepcode-doctor-test-missing-config.json'),
      PATH: '/usr/bin',
    },
  }))
  const apiKey = result.checks.find(check => check.name === 'API key')

  assert.equal(apiKey?.status, 'fail')
  assert.match(apiKey?.message ?? '', /missing/i)
  assert.equal(result.overall, 'fail')
})

test('network failure returns a warning without throwing', async () => {
  const result = await runDoctorChecks(okCheckOptions({
    fetchImpl: async () => {
      throw new Error('offline')
    },
  }))
  const network = result.checks.find(check => check.name === 'Network')

  assert.equal(network?.status, 'warn')
  assert.match(network?.message ?? '', /unreachable/i)
})

test('network check honors its timeout', async () => {
  const started = Date.now()
  const result = await runDoctorChecks(okCheckOptions({
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    }),
    timeoutMs: 5,
  }))
  const network = result.checks.find(check => check.name === 'Network')

  assert.equal(network?.status, 'warn')
  assert.equal(Date.now() - started < 500, true)
})

test('missing LSP binaries return a warning', async () => {
  const result = await runDoctorChecks(okCheckOptions({
    isCommandAvailable: () => false,
  }))
  const lsp = result.checks.find(check => check.name === 'LSP servers')

  assert.equal(lsp?.status, 'warn')
  assert.match(lsp?.message ?? '', /missing/i)
  assert.match(lsp?.message ?? '', /typescript-language-server/)
})

test('summarizeDoctorChecks treats any failure as overall fail', () => {
  assert.equal(
    summarizeDoctorChecks([
      { name: 'one', status: 'ok', message: 'ok' },
      { name: 'two', status: 'fail', message: 'failed' },
      { name: 'three', status: 'warn', message: 'warned' },
    ]),
    'fail',
  )
})

test('doctorHandler JSON output does not expose the full API key', async () => {
  const secret = 'sk-full-secret-token-1234567890'
  let output = ''

  await doctorHandler({
    checksRunner: () => runDoctorChecks(okCheckOptions({
      env: {
        DEEPCODE_CONFIG_FILE: join(tmpdir(), 'deepcode-doctor-test-missing-config.json'),
        DEEPSEEK_API_KEY: secret,
        PATH: '/usr/bin',
      },
    })),
    json: true,
    stdout: { write: chunk => { output += chunk } },
  })

  assert.doesNotMatch(output, new RegExp(secret))
  assert.match(output, /sk-f/)
  assert.match(output, /7890/)
})

test('plain text handler uses the same checks as JSON mode', async () => {
  let output = ''
  const result = await doctorHandler({
    checksRunner: () => runDoctorChecks(okCheckOptions()),
    json: false,
    stdout: { write: chunk => { output += chunk } },
  })

  assert.equal(result.overall, 'ok')
  assert.match(output, /Deep Code Doctor/)
  assert.match(output, /\[OK\] API key/)
})

function okCheckOptions(overrides = {}) {
  return {
    env: OK_ENV,
    fetchImpl: async () => ({ ok: true, status: 204 }),
    isCommandAvailable: () => true,
    timeoutMs: 10,
    ...overrides,
  }
}
