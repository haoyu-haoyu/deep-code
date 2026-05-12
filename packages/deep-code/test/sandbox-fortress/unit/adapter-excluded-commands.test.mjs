import assert from 'node:assert/strict'
import { runLegacyProbe, test } from './adapter-path-resolution.test.mjs'

test('adds excluded commands using exact and Bash suggestion patterns', async () => {
  const data = await runLegacyProbe(`
    import { addToExcludedCommands } from './src/sandbox-fortress/adapter/legacy.ts'
    import {
      __settingsUpdates,
      __setSourceSettings,
      getSettingsForSource,
    } from './src/utils/settings/settings.js'

    __setSourceSettings('localSettings', {
      sandbox: { excludedCommands: ['git status'] },
    })

    const suggested = addToExcludedCommands('npm run test -- --watch', [
      {
        type: 'addRules',
        rules: [
          { toolName: 'Bash', ruleContent: 'npm run test:*' },
          { toolName: 'Read', ruleContent: '/tmp/**' },
        ],
      },
    ])
    const duplicate = addToExcludedCommands('npm run test -- --watch', [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm run test:*' }],
      },
    ])
    const exact = addToExcludedCommands('echo 资料')

    process.stdout.write(JSON.stringify({
      suggested,
      duplicate,
      exact,
      excludedCommands: getSettingsForSource('localSettings').sandbox.excludedCommands,
      updates: __settingsUpdates,
    }))
  `)

  assert.equal(data.suggested, 'npm run test')
  assert.equal(data.duplicate, 'npm run test')
  assert.equal(data.exact, 'echo 资料')
  assert.deepEqual(data.excludedCommands, [
    'git status',
    'npm run test',
    'echo 资料',
  ])
  assert.equal(data.updates.length, 2)
})

test('surfaces malformed permission update shapes', async () => {
  const data = await runLegacyProbe(`
    import { addToExcludedCommands } from './src/sandbox-fortress/adapter/legacy.ts'
    import { __setSourceSettings } from './src/utils/settings/settings.js'

    __setSourceSettings('localSettings', {
      sandbox: { excludedCommands: [] },
    })

    function capture(fn) {
      try {
        fn()
        return 'NO_THROW'
      } catch (error) {
        return error.name + ':' + error.message
      }
    }

    const unsupportedType = addToExcludedCommands('pnpm build', [
      { type: 'removeRules', rules: [{ toolName: 'Bash', ruleContent: 'ignored:*' }] },
    ])

    process.stdout.write(JSON.stringify({
      unsupportedType,
      malformedRules: capture(() => addToExcludedCommands('npm start', [
        { type: 'addRules', rules: null },
      ])),
    }))
  `)

  assert.equal(data.unsupportedType, 'pnpm build')
  assert.match(data.malformedRules, /^TypeError:/)
})
