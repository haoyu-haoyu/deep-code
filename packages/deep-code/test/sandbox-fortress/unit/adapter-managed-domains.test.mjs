import assert from 'node:assert/strict'
import { runLegacyProbe, test } from './adapter-path-resolution.test.mjs'

test('reads managed-domain policy state and surfaces settings errors', async () => {
  const data = await runLegacyProbe(`
    import { shouldAllowManagedSandboxDomainsOnly } from './src/sandbox-fortress/adapter/legacy.ts'
    import {
      __resetSettings,
      __setSourceSettings,
      __throwForSource,
    } from './src/utils/settings/settings.js'

    function capture(fn) {
      try {
        return { value: fn() }
      } catch (error) {
        return { error: error.name + ':' + error.message }
      }
    }

    __resetSettings()
    const absentPolicy = shouldAllowManagedSandboxDomainsOnly()

    __setSourceSettings('policySettings', {
      sandbox: { network: { allowManagedDomainsOnly: false } },
    })
    const explicitFalse = shouldAllowManagedSandboxDomainsOnly()

    __setSourceSettings('policySettings', {
      sandbox: { network: { allowManagedDomainsOnly: true } },
    })
    const explicitTrue = shouldAllowManagedSandboxDomainsOnly()

    __throwForSource('policySettings')
    const thrown = capture(() => shouldAllowManagedSandboxDomainsOnly())

    process.stdout.write(JSON.stringify({
      absentPolicy,
      explicitFalse,
      explicitTrue,
      thrown,
    }))
  `)

  assert.equal(data.absentPolicy, false)
  assert.equal(data.explicitFalse, false)
  assert.equal(data.explicitTrue, true)
  assert.match(data.thrown.error, /^Error:settings unavailable$/)
})
