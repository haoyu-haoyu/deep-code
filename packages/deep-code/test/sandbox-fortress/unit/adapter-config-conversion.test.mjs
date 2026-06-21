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
        // the merged-param ripgrep is now IGNORED — only policy/user sources win
        ripgrep: { command: 'param-ignored', args: ['--json'] },
      },
    }
    __setMergedSettings(normalSettings)
    __setSourceSettings('projectSettings', {
      permissions: {
        allow: ['Edit(/src/**)'],
        deny: ['Edit(//etc/passwd)', 'Read(/private/**)'],
      },
      // SECURITY (Survey-57): a workspace project ripgrep.command must NEVER win —
      // it would swap the binary the sandbox spawns UNSANDBOXED on the host.
      sandbox: { ripgrep: { command: 'project-evil' } },
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
    __setSourceSettings('userSettings', {
      // a trusted (machine-owner global) ripgrep IS honored
      sandbox: { ripgrep: { command: 'rg-custom', args: ['--json'] } },
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
          httpProxyPort: 8080,
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
        network: {
          allowedDomains: ['settings.example.com'],
          // workspace-controlled network RELAXATIONS — must be DROPPED under the
          // allowManagedDomainsOnly lock (sourced from policySettings only)
          allowAllUnixSockets: true,
          allowUnixSockets: ['/var/run/docker.sock'],
          httpProxyPort: 9999,
        },
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
  // ripgrep.command comes from the trusted userSettings source, NOT the merged
  // param (param-ignored) and NOT the workspace projectSettings (project-evil) —
  // a workspace can never swap the unsandboxed-spawned ripgrep binary (Survey-57).
  assert.equal(data.normal.ripgrep.command, 'rg-custom')
  assert.notEqual(data.normal.ripgrep.command, 'param-ignored')
  assert.notEqual(data.normal.ripgrep.command, 'project-evil')
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
  // SECURITY regression (Survey-25 F3): the LEGACY settings path for every source
  // must now be in the denyWrite floor — getSettingsReadFilePathForSource reads
  // the legacy `.claude/settings.{json,local.json}` as authoritative when the
  // `.deepcode/` equivalent is absent, so leaving it writable was a sandbox
  // config-tamper escape. (The stub models the legacy path as `<root>/legacy-
  // settings.json`.)
  assert.ok(
    data.normal.filesystem.denyWrite.includes(
      '/workspace/project/.claude/legacy-settings.json',
    ),
    'legacy settings path must be deny-write (the F3 fix)',
  )
  // The cd'd-cwd block now covers BOTH the `.deepcode/` and `.claude/` settings
  // (and the .local variant), not just `.claude/settings.json`.
  for (const path of [
    `${data.repo}/.deepcode/settings.json`,
    `${data.repo}/.deepcode/settings.local.json`,
    `${data.repo}/.claude/settings.local.json`,
  ]) {
    assert.ok(
      data.normal.filesystem.denyWrite.includes(path),
      `settings file must be deny-write: ${path}`,
    )
  }
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
  // SECURITY (Survey-56): under allowManagedDomainsOnly the WHOLE sandbox.network
  // object is sourced from policySettings, so a workspace-controlled network
  // relaxation is DROPPED (fail-closed) — not just allowedDomains. The proxy port
  // is the managed 8080, not the workspace 9999; the workspace socket relaxations
  // (allowAllUnixSockets / allowUnixSockets) vanish because policy never set them.
  assert.equal(data.managedOnly.network.httpProxyPort, 8080)
  assert.equal(data.managedOnly.network.allowAllUnixSockets, undefined)
  assert.equal(data.managedOnly.network.allowUnixSockets, undefined)
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
