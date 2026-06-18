import assert from 'node:assert/strict'
import { runLegacyProbe, test } from './adapter-path-resolution.test.mjs'

test('converts merged settings into sandbox runtime config', async () => {
  const data = await runLegacyProbe(`
    import {
      convertToSandboxRuntimeConfig,
      SandboxRuntimeConfigSchema,
    } from './src/sandbox-fortress/adapter/legacy.ts'
    import { mkdirSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    import {
      __setAdditionalDirectoriesForClaudeMd,
      __setCwdState,
    } from './src/bootstrap/state.js'
    import {
      __resetSettings,
      __setMergedSettings,
      __setSourceSettings,
    } from './src/utils/settings/settings.js'

    __resetSettings()
    const repo = join(process.cwd(), 'repo')
    const original = join(process.cwd(), 'original')
    mkdirSync(repo, { recursive: true })
    mkdirSync(original, { recursive: true })
    writeFileSync(join(repo, 'HEAD'), 'ref: refs/heads/main\\n')
    __setCwdState(repo, original)
    __setAdditionalDirectoriesForClaudeMd(['/workspace/session-added'])
    const normalSettings = {
      permissions: {
        allow: ['WebFetch(domain:api.deepseek.com)'],
        deny: ['WebFetch(domain:blocked.example.com)'],
        additionalDirectories: ['/workspace/extra'],
      },
      sandbox: {
        network: {
          allowedDomains: ['docs.deepseek.com'],
          allowUnixSockets: ['/tmp/deepcode.sock'],
          allowLocalBinding: true,
          httpProxyPort: 8080,
          socksProxyPort: 1080,
        },
        ignoreViolations: { enabled: true },
        enableWeakerNestedSandbox: true,
        ripgrep: { command: 'rg-custom', args: ['--json'], argv0: 'rg-custom' },
      },
    }
    __setMergedSettings(normalSettings)
    __setSourceSettings('projectSettings', {
      permissions: {
        allow: ['Edit(/src/**)'],
        deny: ['Edit(//etc/passwd)', 'Read(/private/**)'],
      },
    })
    __setSourceSettings('localSettings', {
      sandbox: {
        filesystem: {
          allowWrite: ['cache'],
          denyWrite: ['/absolute-deny'],
          denyRead: ['//private/legacy'],
          allowRead: ['./docs'],
        },
      },
    })

    const normal = convertToSandboxRuntimeConfig(structuredClone(normalSettings))
    const schemaResult = SandboxRuntimeConfigSchema.safeParse(normal)

    __resetSettings()
    __setMergedSettings({
      permissions: {
        allow: ['WebFetch(domain:user-config.example.com)'],
        deny: [],
      },
      sandbox: {
        network: { allowedDomains: ['settings.example.com'] },
      },
    })
    __setSourceSettings('policySettings', {
      sandbox: {
        network: {
          allowManagedDomainsOnly: true,
          allowedDomains: ['managed.example.com'],
        },
        filesystem: {
          allowManagedReadPathsOnly: true,
          allowRead: ['policy-read'],
        },
      },
      permissions: {
        allow: ['WebFetch(domain:policy-rule.example.com)'],
      },
    })
    __setSourceSettings('localSettings', {
      sandbox: {
        filesystem: {
          allowRead: ['local-read'],
        },
      },
    })
    const managedOnly = convertToSandboxRuntimeConfig({
      permissions: {
        allow: ['WebFetch(domain:user-config.example.com)'],
        deny: [],
      },
      sandbox: {
        network: { allowedDomains: ['settings.example.com'] },
      },
    })

    process.stdout.write(JSON.stringify({
      normal,
      schemaSuccess: schemaResult.success,
      managedOnly,
      repo,
      original,
    }))
  `)

  assert.equal(data.schemaSuccess, true)
  assert.deepEqual(data.normal.network.allowedDomains, [
    'docs.deepseek.com',
    'api.deepseek.com',
  ])
  assert.deepEqual(data.normal.network.deniedDomains, [
    'blocked.example.com',
  ])
  assert.equal(data.normal.network.allowLocalBinding, true)
  assert.equal(data.normal.network.httpProxyPort, 8080)
  assert.equal(data.normal.ripgrep.command, 'rg-custom')
  assert.equal(data.normal.ignoreViolations.enabled, true)
  assert.equal(data.normal.enableWeakerNestedSandbox, true)
  assert.ok(data.normal.filesystem.allowWrite.includes('.'))
  assert.ok(data.normal.filesystem.allowWrite.includes('/tmp/deepcode-temp'))
  assert.ok(data.normal.filesystem.allowWrite.includes('/workspace/extra'))
  assert.ok(
    data.normal.filesystem.allowWrite.includes('/workspace/session-added'),
  )
  assert.ok(
    data.normal.filesystem.allowWrite.includes(
      '/workspace/project/.claude/src/**',
    ),
  )
  assert.ok(
    data.normal.filesystem.allowWrite.includes(
      '/workspace/project/.claude/cache',
    ),
  )
  assert.ok(data.normal.filesystem.denyWrite.includes('/etc/passwd'))
  assert.ok(data.normal.filesystem.denyWrite.includes('/absolute-deny'))
  assert.ok(data.normal.filesystem.denyWrite.includes(`${data.repo}/HEAD`))
  assert.ok(
    data.normal.filesystem.denyWrite.includes(
      `${data.repo}/.claude/settings.json`,
    ),
  )
  assert.ok(
    data.normal.filesystem.denyWrite.includes(`${data.repo}/.claude/skills`),
  )
  assert.ok(
    data.normal.filesystem.denyWrite.includes(
      `${data.original}/.claude/skills`,
    ),
  )
  // the DeepSeek credential store (apiKey + baseUrl) must be deny-write —
  // writing it is credential theft + a redirect of all inference traffic
  assert.ok(
    data.normal.filesystem.denyWrite.some(p => p.endsWith('deepseek-config.json')),
    'deepseek-config.json must be in the sandbox denyWrite set',
  )
  assert.ok(
    data.normal.filesystem.denyRead.includes(
      '/workspace/project/.claude/private/**',
    ),
  )
  assert.ok(data.normal.filesystem.denyRead.includes('/private/legacy'))
  assert.ok(
    data.normal.filesystem.allowRead.includes(
      '/workspace/project/.claude/docs',
    ),
  )

  assert.deepEqual(data.managedOnly.network.allowedDomains, [
    'managed.example.com',
    'policy-rule.example.com',
  ])
  assert.deepEqual(data.managedOnly.filesystem.allowRead, [
    '/settings/policy/policy-read',
  ])
})

test('rejects invalid conversion inputs and schema shapes', async () => {
  const data = await runLegacyProbe(`
    import {
      convertToSandboxRuntimeConfig,
      SandboxRuntimeConfigSchema,
    } from './src/sandbox-fortress/adapter/legacy.ts'

    function capture(fn) {
      try {
        fn()
        return 'NO_THROW'
      } catch (error) {
        return error.name + ':' + error.message
      }
    }

    const malformedRules = convertToSandboxRuntimeConfig({
      permissions: {
        allow: ['WebFetch(domain:ok.example.com', 'MalformedRule'],
        deny: ['WebFetch(domain:blocked.example.com)'],
      },
      sandbox: {},
    })

    process.stdout.write(JSON.stringify({
      nullSettings: capture(() => convertToSandboxRuntimeConfig(null)),
      invalidSchema: SandboxRuntimeConfigSchema.safeParse({ network: {} }),
      malformedRules,
    }))
  `)

  assert.match(data.nullSettings, /^TypeError:/)
  assert.equal(data.invalidSchema.success, false)
  assert.deepEqual(data.malformedRules.network.allowedDomains, [])
  assert.deepEqual(data.malformedRules.network.deniedDomains, [
    'blocked.example.com',
  ])
})
