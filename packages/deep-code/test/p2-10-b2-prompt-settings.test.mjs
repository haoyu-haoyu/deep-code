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

const expectedB2Keys = [
  'promptInput.placeholder.messageAgent',
  'promptInput.placeholder.editQueuedMessages',
  'promptInput.helpMenu.bashMode',
  'promptInput.helpMenu.commands',
  'promptInput.helpMenu.filePaths',
  'promptInput.helpMenu.background',
  'promptInput.helpMenu.clearInput',
  'promptInput.helpMenu.undo',
  'promptInput.helpMenu.pasteImages',
  'promptInput.helpMenu.switchModel',
  'promptInput.helpMenu.stashPrompt',
  'promptInput.queuedCommands.moreTasksCompleted',
  'promptInput.stashNotice.autoRestores',
  'promptInput.sandbox.blocked',
  'promptInput.sandbox.operationSingular',
  'promptInput.sandbox.operationPlural',
  'settings.invalidDialog.title',
  'settings.invalidDialog.body',
  'settings.invalidDialog.exitAndFix',
  'settings.invalidDialog.continueWithout',
  'settings.section.status',
  'settings.section.config',
  'settings.section.gates',
  'settings.status.dismissed',
  'settings.status.unnamedSessionHint',
  'settings.status.version',
  'settings.status.sessionName',
  'settings.status.sessionId',
  'settings.status.cwd',
  'settings.status.model',
  'settings.status.deepSeekHeading',
  'settings.status.systemDiagnostics',
  'settings.config.autoCompact',
  'settings.config.showTips',
  'settings.config.reduceMotion',
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

function createPlaceholderFixture() {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'deepcode-i18n-placeholder-'))
  mkdirSync(resolve(fixtureRoot, 'i18n/messages'), { recursive: true })

  for (const file of ['index.ts', 'locales.ts', 'types.ts']) {
    copyFileSync(resolve(i18nSourceRoot, file), resolve(fixtureRoot, 'i18n', file))
  }
  copyFileSync(
    resolve(i18nSourceRoot, 'messages/en.ts'),
    resolve(fixtureRoot, 'i18n/messages/en.ts'),
  )
  writeFileSync(
    resolve(fixtureRoot, 'mock-react.ts'),
    `
      export function useMemo(factory) {
        return factory()
      }
    `,
  )
  writeFileSync(
    resolve(fixtureRoot, 'placeholder-mocks.ts'),
    `
      import { translate } from './i18n/index.ts'

      export function useCommandQueue() {
        return [{ value: 'queued prompt', mode: 'prompt' }]
      }

      export function useAppState(selector) {
        return selector({ promptSuggestionEnabled: false })
      }

      export function getGlobalConfig() {
        return { queuedCommandUpHintCount: 0 }
      }

      export function getExampleCommandFromCache() {
        return 'example command'
      }

      export function isQueuedCommandEditable() {
        return true
      }

      export function useTranslation() {
        return {
          locale: 'en',
          t(key, params) {
            return translate('en', key, params)
          },
        }
      }
    `,
  )

  const placeholderSource = readFileSync(
    resolve(packageRoot, 'src/components/PromptInput/usePromptInputPlaceholder.ts'),
    'utf8',
  )
    .replace("import { feature } from 'bun:bundle'\n", 'const feature = () => false\n')
    .replace("import { useMemo } from 'react'\n", "import { useMemo } from './mock-react.ts'\n")
    .replace(
      "import { useCommandQueue } from 'src/hooks/useCommandQueue.js'\n",
      "import { useCommandQueue } from './placeholder-mocks.ts'\n",
    )
    .replace(
      "import { useAppState } from 'src/state/AppState.js'\n",
      "import { useAppState } from './placeholder-mocks.ts'\n",
    )
    .replace(
      "import { getGlobalConfig } from 'src/utils/config.js'\n",
      "import { getGlobalConfig } from './placeholder-mocks.ts'\n",
    )
    .replace(
      "import { getExampleCommandFromCache } from 'src/utils/exampleCommands.js'\n",
      "import { getExampleCommandFromCache } from './placeholder-mocks.ts'\n",
    )
    .replace(
      "import { isQueuedCommandEditable } from 'src/utils/messageQueueManager.js'\n",
      "import { isQueuedCommandEditable } from './placeholder-mocks.ts'\n",
    )
    .replace(
      "import { useTranslation } from '../../i18n/useTranslation.js'\n",
      "import { useTranslation } from './placeholder-mocks.ts'\n",
    )

  writeFileSync(resolve(fixtureRoot, 'usePromptInputPlaceholder.ts'), placeholderSource)
  return fixtureRoot
}

function runPlaceholderExpression(expression) {
  const fixtureRoot = createPlaceholderFixture()

  try {
    const result = spawnSync(
      'bun',
      [
        '--eval',
        `
          import { usePromptInputPlaceholder } from './usePromptInputPlaceholder.ts'
          const result = await (${expression})
          process.stdout.write(JSON.stringify(result))
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

test('English catalog contains the scoped P2.10.b.2 key set', () => {
  const entries = runI18nExpression('Object.entries(EN_MESSAGES)')
  const keys = new Set(entries.map(([key]) => key))

  // Lower bound only: this phase test verifies the b.2 key set is PRESENT; the
  // global catalog upper bound is owned solely by p2-10-i18n.test.mjs so it does
  // not have to be re-bumped in every per-phase test as later batches add keys.
  assert.ok(entries.length >= 105, `expected at least 105 keys, got ${entries.length}`)

  for (const key of expectedB2Keys) {
    assert.ok(keys.has(key), `missing P2.10.b.2 key: ${key}`)
  }
})

test('prompt input and settings keys resolve in English', () => {
  assert.equal(
    runI18nExpression("translate('en', 'promptInput.helpMenu.bashMode')"),
    '! for bash mode',
  )
  assert.equal(
    runI18nExpression("translate('en', 'settings.invalidDialog.title')"),
    'Settings Error',
  )
  assert.equal(
    runI18nExpression("translate('en', 'settings.config.autoCompact')"),
    'Auto-compact',
  )
})

test('P2.10.b.2 parameterized keys interpolate without changing English copy', () => {
  assert.equal(
    runI18nExpression(
      "translate('en', 'promptInput.queuedCommands.moreTasksCompleted', { count: 4 })",
    ),
    '+4 more tasks completed',
  )
  assert.equal(
    runI18nExpression(
      "translate('en', 'promptInput.sandbox.blocked', { count: 2, operationLabel: 'operations', shortcut: 'ctrl+o' })",
    ),
    '⧈ Sandbox blocked 2 operations · ctrl+o for details · /sandbox to disable',
  )
  assert.equal(
    runI18nExpression(
      "translate('en', 'promptInput.placeholder.messageAgent', { name: 'teammate' })",
    ),
    'Message @teammate…',
  )
})

test('usePromptInputPlaceholder returns the English queued-message hint', () => {
  assert.equal(
    runPlaceholderExpression(
      "usePromptInputPlaceholder({ input: '', submitCount: 1 })",
    ),
    'Press up to edit queued messages',
  )
})
