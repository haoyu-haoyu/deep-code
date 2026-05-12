import assert from 'node:assert/strict'
import { runLegacyProbe, test } from './adapter-path-resolution.test.mjs'

test('initializes, resets, blocks managed-domain prompts, and retries after base failure', async () => {
  const data = await runLegacyProbe(`
    import { SandboxManager } from './src/sandbox-fortress/adapter/legacy.ts'
    import { mkdirSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    import {
      __baseSandboxState,
      __failNextInitialize,
      __getMockBaseSandboxManager,
    } from '@anthropic-ai/sandbox-runtime'
    import { __setCwdState } from './src/bootstrap/state.js'
    import {
      __changeDetectorState,
      __emitSettingsChange,
    } from './src/utils/settings/changeDetector.js'
    import {
      __resetSettings,
      __setMergedSettings,
      __setSourceSettings,
    } from './src/utils/settings/settings.js'

    function enableSandbox() {
      __setMergedSettings({
        permissions: {},
        sandbox: { enabled: true },
      })
    }

    __resetSettings()
    enableSandbox()
    const worktree = join(process.cwd(), 'worktree')
    const mainRepo = join(process.cwd(), 'main-repo')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(
      join(worktree, '.git'),
      'gitdir: ' + mainRepo + '/.git/worktrees/f1-3\\n',
    )
    __setCwdState(worktree, worktree)
    __setSourceSettings('policySettings', {
      sandbox: { network: { allowManagedDomainsOnly: true } },
    })

    await SandboxManager.initialize(async () => true)
    const initializedAfterFirst = __getMockBaseSandboxManager().isInitialized()
    const firstConfig = __baseSandboxState.initializeCalls.at(-1).config
    const blockedByManagedPolicy = await __baseSandboxState.lastCallback({
      host: 'blocked.example.com',
    })
    __emitSettingsChange()
    const updateCountAfterEmit = __baseSandboxState.updateConfigs.length

    await SandboxManager.reset()
    const initializedAfterReset = __getMockBaseSandboxManager().isInitialized()
    const cleanupCountAfterReset = __changeDetectorState.cleanupCount

    enableSandbox()
    __failNextInitialize('init boom')
    await SandboxManager.initialize()
    const initializedAfterFailure = __getMockBaseSandboxManager().isInitialized()
    const callsAfterFailure = __baseSandboxState.initializeCalls.length

    await SandboxManager.initialize()
    const initializedAfterRetry = __getMockBaseSandboxManager().isInitialized()
    const callsAfterRetry = __baseSandboxState.initializeCalls.length

    process.stdout.write(JSON.stringify({
      initializedAfterFirst,
      firstConfig,
      mainRepo,
      blockedByManagedPolicy,
      updateCountAfterEmit,
      initializedAfterReset,
      cleanupCountAfterReset,
      initializedAfterFailure,
      callsAfterFailure,
      initializedAfterRetry,
      callsAfterRetry,
      resetCalls: __baseSandboxState.resetCalls,
      subscribeCount: __changeDetectorState.subscribeCount,
    }))
  `)

  assert.equal(data.initializedAfterFirst, true)
  assert.equal(data.firstConfig.network.allowedDomains.length, 0)
  assert.equal(data.firstConfig.filesystem.allowWrite[0], '.')
  assert.ok(data.firstConfig.filesystem.allowWrite.includes(data.mainRepo))
  assert.equal(data.blockedByManagedPolicy, false)
  assert.equal(data.updateCountAfterEmit, 1)
  assert.equal(data.initializedAfterReset, false)
  assert.equal(data.cleanupCountAfterReset, 1)
  assert.equal(data.initializedAfterFailure, false)
  assert.equal(data.initializedAfterRetry, true)
  assert.equal(data.callsAfterRetry, data.callsAfterFailure + 1)
  assert.equal(data.resetCalls, 1)
  assert.equal(data.subscribeCount, 2)
})
