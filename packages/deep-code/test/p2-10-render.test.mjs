import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(testDir, '..')
const i18nSourceRoot = resolve(packageRoot, 'src/i18n')

function createI18nHookFixture() {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'deepcode-i18n-render-'))
  mkdirSync(resolve(fixtureRoot, 'messages'), { recursive: true })

  for (const file of ['index.ts', 'locales.ts', 'types.ts']) {
    copyFileSync(resolve(i18nSourceRoot, file), resolve(fixtureRoot, file))
  }
  for (const messages of ['messages/en.ts', 'messages/zh-Hans.ts']) {
    copyFileSync(
      resolve(i18nSourceRoot, messages),
      resolve(fixtureRoot, messages),
    )
  }
  writeFileSync(
    resolve(fixtureRoot, 'mock-react.ts'),
    `
      export type ReactNode = unknown

      export function createContext(defaultValue) {
        return { defaultValue, Provider: { displayName: 'MockProvider' } }
      }

      export function createElement(type, props, ...children) {
        return { type, props: { ...(props ?? {}), children } }
      }

      export function useContext(context) {
        return context.defaultValue
      }

      export function useMemo(factory) {
        return factory()
      }
    `,
  )

  const hookSource = readFileSync(
    resolve(i18nSourceRoot, 'useTranslation.ts'),
    'utf8',
  ).replace("from 'react'", "from './mock-react.ts'")
  writeFileSync(resolve(fixtureRoot, 'useTranslation.ts'), hookSource)

  return fixtureRoot
}

function evaluateHookConsumer(providerLocale) {
  const fixtureRoot = createI18nHookFixture()
  const providerLocaleArg = providerLocale === undefined
    ? 'undefined'
    : JSON.stringify(providerLocale)

  try {
    const result = spawnSync(
      'bun',
      [
        '--eval',
        `
          import { TranslationProvider, useTranslation } from './useTranslation.ts'

          function HookConsumer() {
            const { locale, t } = useTranslation()
            return locale + ':' + t('languagePicker.prompt')
          }

          const providerLocale = ${providerLocaleArg}
          const hookOutput = HookConsumer()
          const provider = providerLocale === undefined
            ? null
            : TranslationProvider({ locale: providerLocale, children: 'child' })
          process.stdout.write(JSON.stringify({
            hookOutput,
            providerLocale: provider?.props?.value?.locale,
          }))
        `,
      ],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production' },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

test('useTranslation renders English text without an explicit provider', () => {
  const { hookOutput } = evaluateHookConsumer()

  assert.match(hookOutput, /Enter your preferred response and voice language:/)
  assert.match(hookOutput, /en:/)
})

test('TranslationProvider supplies normalized locale while preserving English fallback', () => {
  const { hookOutput, providerLocale } = evaluateHookConsumer('ja-JP')

  assert.match(hookOutput, /Enter your preferred response and voice language:/)
  assert.match(hookOutput, /en:/)
  assert.equal(providerLocale, 'ja')
})
