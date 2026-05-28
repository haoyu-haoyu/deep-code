import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(testDir, '..')

function runI18nExpression(expression) {
  const result = spawnSync(
    'bun',
    [
      '--eval',
      `
        import { getMessage, resolveLocale, setActiveLocale, translate } from './src/i18n/index.ts'
        import { normalizeLocale } from './src/i18n/locales.ts'
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

test('translate returns the English catalog value', () => {
  assert.equal(runI18nExpression("translate('en', 'help.title')"), 'Help')
})

test('translate interpolates named placeholders', () => {
  assert.equal(
    runI18nExpression(
      "translate('en', 'restore.snapshot.count', { count: 3 })",
    ),
    '3 snapshots',
  )
})

test('missing keys return the key string without throwing', () => {
  assert.equal(
    runI18nExpression("translate('en', 'missing.example.key')"),
    'missing.example.key',
  )
})

test('normalizeLocale maps Simplified Chinese locale aliases', () => {
  assert.equal(runI18nExpression("normalizeLocale('zh-CN')"), 'zh-Hans')
})

test('normalizeLocale falls back unknown locales to English', () => {
  assert.equal(runI18nExpression("normalizeLocale('xyz')"), 'en')
})

test('resolveLocale honors explicit override before other signals', () => {
  assert.equal(
    runI18nExpression(
      "resolveLocale({ override: 'ja', env: { LC_ALL: 'zh-CN', LANG: 'en-US' } })",
    ),
    'ja',
  )
})

test('getMessage reads the active locale with English fallback', () => {
  assert.equal(
    runI18nExpression(
      "(() => { setActiveLocale('ja'); const message = getMessage('help.title'); setActiveLocale('en'); return message })()",
    ),
    'Help',
  )
})

test('English catalog has a bounded non-empty string message set', () => {
  const entries = runI18nExpression('Object.entries(EN_MESSAGES)')

  assert.ok(entries.length >= 105, `expected at least 105 keys, got ${entries.length}`)
  assert.ok(entries.length <= 115, `expected at most 115 keys, got ${entries.length}`)
  for (const [key, value] of entries) {
    assert.equal(typeof key, 'string')
    assert.equal(typeof value, 'string')
    assert.notEqual(value.trim(), '')
  }
})
