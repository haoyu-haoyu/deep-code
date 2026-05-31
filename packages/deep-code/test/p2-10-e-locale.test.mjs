import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configSource = readFileSync(resolve(packageRoot, 'src/utils/config.ts'), 'utf8')
const mainSource = readFileSync(resolve(packageRoot, 'src/main.tsx'), 'utf8')

function evalTs(expression, imports = '') {
  const result = spawnSync(
    'bun',
    [
      '--eval',
      `
        import { initActiveLocale, getActiveLocale, resolveLocale, setActiveLocale } from './src/i18n/index.ts'
        import { normalizeLocale } from './src/i18n/locales.ts'
        ${imports}
        const result = await (${expression})
        process.stdout.write(JSON.stringify(result))
      `,
    ],
    { cwd: packageRoot, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('initActiveLocale priority: --locale override beats persisted config and env', () => {
  assert.equal(
    evalTs("(() => { initActiveLocale({ override: 'ja', configLocale: 'zh-CN', env: { LANG: 'en-US' } }); return getActiveLocale() })()"),
    'ja',
  )
})

test('initActiveLocale falls back to persisted GlobalConfig.locale when no override', () => {
  assert.equal(
    evalTs("(() => { initActiveLocale({ configLocale: 'zh-CN', env: {} }); return getActiveLocale() })()"),
    'zh-Hans',
  )
})

test('initActiveLocale falls back to LC_ALL / LANG when no override or config', () => {
  assert.equal(
    evalTs("(() => { initActiveLocale({ env: { LANG: 'ja_JP.UTF-8' } }); return getActiveLocale() })()"),
    'ja',
  )
  assert.equal(
    evalTs("(() => { initActiveLocale({ env: { LC_ALL: 'zh-CN', LANG: 'en-US' } }); return getActiveLocale() })()"),
    'zh-Hans',
  )
})

test('initActiveLocale resolves unknown signals to English', () => {
  assert.equal(
    evalTs("(() => { initActiveLocale({ override: undefined, configLocale: undefined, env: { LANG: 'xx-YY' } }); return getActiveLocale() })()"),
    'en',
  )
})

test('/locale command is registered as a local-jsx UI command', () => {
  const meta = evalTs(
    "(() => ({ name: locale.name, type: locale.type, hasLoad: typeof locale.load === 'function', description: locale.description }))()",
    "import locale from './src/commands/locale/index.ts'",
  )
  assert.equal(meta.name, 'locale')
  assert.equal(meta.type, 'local-jsx')
  assert.equal(meta.hasLoad, true)
  assert.equal(meta.description, 'Change UI locale')
})

test('locale is a persisted GlobalConfig field + key (settings.locale)', () => {
  // config.ts cannot be imported standalone (pulls build-time deps), so assert
  // the persisted-locale wiring statically.
  assert.match(configSource, /\blocale\?: string/, 'GlobalConfig should declare an optional locale field')
  assert.match(configSource, /GLOBAL_CONFIG_KEYS = \[[\s\S]*?'locale'[\s\S]*?\]/, "'locale' should be in GLOBAL_CONFIG_KEYS")
})

test('main entrypoint wires --locale and resolves the UI locale at startup', () => {
  assert.match(mainSource, /\.option\('--locale <locale>'/, 'a --locale CLI option should be registered')
  assert.match(mainSource, /initActiveLocale\(\{[^}]*override: options\.locale[^}]*configLocale: getGlobalConfig\(\)\.locale/, 'startup should resolve locale from --locale + GlobalConfig.locale')
  assert.match(mainSource, /import \{[^}]*\binitActiveLocale\b[^}]*\} from '\.\/i18n\/index\.js'/, 'main should import initActiveLocale')
})
