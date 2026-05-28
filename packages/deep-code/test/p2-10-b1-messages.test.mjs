import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(testDir, '..')

const expectedB1Keys = [
  'tokenWarning.collapse.errors',
  'tokenWarning.collapse.idle',
  'tokenWarning.collapse.summarized',
  'tokenWarning.autoCompact.used',
  'tokenWarning.autoCompact.until',
  'tokenWarning.approaching',
  'tokenWarning.compactAction',
  'diagnostics.issue.singular',
  'diagnostics.issue.plural',
  'diagnostics.file.singular',
  'diagnostics.file.plural',
  'diagnostics.suggestion',
  'tool.useError.executionFailed',
  'tool.useError.invalidParameters',
  'tool.useError.prefix',
  'tool.useError.truncatedLines',
  'tool.useError.toSeeAll',
  'tool.useRejected.fileEdit',
  'tool.useRejected.notebookEdit',
  'tool.useRejected.notebookCell',
  'ide.status.selection',
  'ide.status.inFile',
  'coordinator.main',
  'coordinator.tokens',
  'coordinator.queued',
  'status.thinking.short',
  'status.thinking.expanded',
  'status.thinking.redacted',
  'status.compactedWithHistory',
  'message.apiRetry',
]

function runI18nExpression(expression) {
  const result = spawnSync(
    'bun',
    [
      '--eval',
      `
        import { translate } from './src/i18n/index.ts'
        import { EN_MESSAGES } from './src/i18n/messages/en.ts'
        const result = await (${expression})
        process.stdout.write(JSON.stringify(result))
      `,
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    },
  )

  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('English catalog contains the scoped P2.10.b.1 key set', () => {
  const entries = runI18nExpression('Object.entries(EN_MESSAGES)')
  const keys = new Set(entries.map(([key]) => key))

  assert.ok(entries.length >= 70, `expected at least 70 keys, got ${entries.length}`)
  assert.ok(entries.length <= 80, `expected at most 80 keys, got ${entries.length}`)

  for (const key of expectedB1Keys) {
    assert.ok(keys.has(key), `missing P2.10.b.1 key: ${key}`)
  }
})

test('message and status keys resolve in English', () => {
  assert.equal(
    runI18nExpression("translate('en', 'status.thinking.short')"),
    '∴ Thinking',
  )
  assert.equal(
    runI18nExpression("translate('en', 'coordinator.main')"),
    'main',
  )
  assert.equal(
    runI18nExpression("translate('en', 'tool.useError.executionFailed')"),
    'Tool execution failed',
  )
})

test('P2.10.b.1 parameterized keys interpolate without changing English copy', () => {
  assert.equal(
    runI18nExpression(
      "translate('en', 'tokenWarning.approaching', { percentage: 85, action: 'Run /compact to compact & continue' })",
    ),
    'Context low (85% remaining) · Run /compact to compact & continue',
  )
  assert.equal(
    runI18nExpression(
      "translate('en', 'diagnostics.suggestion', { suggestion: 'restart TypeScript server' })",
    ),
    'Suggestion: restart TypeScript server',
  )
  assert.equal(
    runI18nExpression(
      "translate('en', 'message.apiRetry', { seconds: 2, unit: 'seconds', attempt: 1, maxRetries: 3 })",
    ),
    'Retrying in 2 seconds… (attempt 1/3)',
  )
  assert.equal(
    runI18nExpression(
      "translate('en', 'coordinator.tokens', { arrow: '↓', count: '1,024' })",
    ),
    ' · ↓ 1,024 tokens',
  )
})
