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
        import { ZH_HANS_MESSAGES } from './src/i18n/messages/zh-Hans.ts'
        const placeholders = s => (String(s).match(/\\{[A-Za-z0-9_.-]+\\}/g) || []).sort().join(',')
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

  assert.ok(entries.length >= 585, `expected at least 585 keys, got ${entries.length}`)
  assert.ok(entries.length <= 615, `expected at most 615 keys, got ${entries.length}`)
  for (const [key, value] of entries) {
    assert.equal(typeof key, 'string')
    assert.equal(typeof value, 'string')
    assert.notEqual(value.trim(), '')
  }
})

test('zh-Hans catalog covers every English key (completeness)', () => {
  const result = runI18nExpression(`(() => {
    const en = Object.keys(EN_MESSAGES)
    const zh = new Set(Object.keys(ZH_HANS_MESSAGES))
    return {
      enCount: en.length,
      zhCount: zh.size,
      missing: en.filter(k => !zh.has(k)),
      extra: Object.keys(ZH_HANS_MESSAGES).filter(k => !(k in EN_MESSAGES)),
    }
  })()`)
  assert.equal(result.missing.length, 0, `zh-Hans missing keys: ${result.missing.slice(0, 10).join(', ')}`)
  assert.equal(result.extra.length, 0, `zh-Hans has extra keys: ${result.extra.slice(0, 10).join(', ')}`)
  assert.equal(result.zhCount, result.enCount)
})

test('zh-Hans values preserve English placeholder sets (interpolation parity)', () => {
  const mismatches = runI18nExpression(`Object.keys(EN_MESSAGES)
    .filter(k => ZH_HANS_MESSAGES[k] !== undefined && placeholders(EN_MESSAGES[k]) !== placeholders(ZH_HANS_MESSAGES[k]))
    .map(k => ({ key: k, en: placeholders(EN_MESSAGES[k]), zh: placeholders(ZH_HANS_MESSAGES[k]) }))`)
  assert.equal(mismatches.length, 0, `placeholder mismatches: ${JSON.stringify(mismatches.slice(0, 8))}`)
})

test('translate resolves Simplified Chinese values', () => {
  assert.equal(runI18nExpression("translate('zh-Hans', 'doctor.title')"), 'Deep Code 诊断')
  assert.equal(runI18nExpression("translate('zh-Hans', 'permission.allowOnce')"), '允许一次')
})

test('zh-Hans interpolation keeps placeholders and English-only tokens intact', () => {
  assert.equal(
    runI18nExpression("translate('zh-Hans', 'restore.snapshot.count', { count: 3 })"),
    '3 个快照',
  )
})

test('zh-Hans normalization maps zh / zh-CN / zh-SG', () => {
  assert.equal(runI18nExpression("normalizeLocale('zh-CN')"), 'zh-Hans')
  assert.equal(runI18nExpression("normalizeLocale('zh')"), 'zh-Hans')
  assert.equal(runI18nExpression("normalizeLocale('zh-SG')"), 'zh-Hans')
})

test('missing key falls back through English to the key string', () => {
  // zh-Hans is complete, so exercise the fallback path with a key in neither catalog.
  assert.equal(
    runI18nExpression("translate('zh-Hans', 'totally.missing.key')"),
    'totally.missing.key',
  )
})
