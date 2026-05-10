import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const profileSourcePath = resolve(
  packageRoot,
  'src/sandbox-fortress/adapter/per-tool-profiles.ts',
)

let cachedProbe
let profileFixtureRoot

function writeFixtureFile(relativePath, content) {
  const target = join(profileFixtureRoot, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function getProfileFixtureRoot() {
  if (profileFixtureRoot) return profileFixtureRoot

  profileFixtureRoot = mkdtempSync(
    join(tmpdir(), 'deepcode-per-tool-profiles-'),
  )
  const profileTarget = join(
    profileFixtureRoot,
    'src/sandbox-fortress/adapter/per-tool-profiles.ts',
  )
  mkdirSync(dirname(profileTarget), { recursive: true })
  copyFileSync(profileSourcePath, profileTarget)

  writeFixtureFile(
    'src/tools/BashTool/toolName.js',
    "export const BASH_TOOL_NAME = 'Bash'\n",
  )
  writeFixtureFile(
    'src/tools/FileEditTool/constants.js',
    "export const FILE_EDIT_TOOL_NAME = 'Edit'\n",
  )
  writeFixtureFile(
    'src/tools/FileReadTool/prompt.js',
    "export const FILE_READ_TOOL_NAME = 'Read'\n",
  )
  writeFixtureFile(
    'src/tools/WebFetchTool/prompt.js',
    "export const WEB_FETCH_TOOL_NAME = 'WebFetch'\n",
  )
  writeFixtureFile('src/sandbox-fortress/types.js', '\n')

  return profileFixtureRoot
}

function runProfileProbe() {
  if (cachedProbe) return cachedProbe

  const script = String.raw`
    import {
      mergeProfileIntoConfig,
      TOOL_PROFILES,
    } from './src/sandbox-fortress/adapter/per-tool-profiles.ts'
    import { BASH_TOOL_NAME } from './src/tools/BashTool/toolName.js'
    import { FILE_EDIT_TOOL_NAME } from './src/tools/FileEditTool/constants.js'
    import { FILE_READ_TOOL_NAME } from './src/tools/FileReadTool/prompt.js'
    import { WEB_FETCH_TOOL_NAME } from './src/tools/WebFetchTool/prompt.js'

    const baseConfig = {
      filesystem: {
        denyRead: ['/private'],
        allowRead: ['/workspace'],
        allowWrite: ['/workspace'],
        denyWrite: ['/workspace/.claude/settings.json'],
      },
      network: {
        allowedDomains: ['api.deepseek.com'],
        deniedDomains: ['blocked.example.com'],
        allowUnixSockets: ['/tmp/base.sock'],
        allowAllUnixSockets: true,
        allowLocalBinding: true,
        httpProxyPort: 3128,
        socksProxyPort: 1080,
      },
    }
    const customConfig = {
      filesystem: {
        denyRead: ['/secret'],
        allowRead: ['/workspace/project'],
        allowWrite: ['/workspace/project'],
        denyWrite: ['/workspace/project/.git/hooks'],
      },
      network: {
        allowedDomains: ['github.com'],
        deniedDomains: ['malware.example.com'],
        allowUnixSockets: ['/tmp/custom.sock'],
        allowAllUnixSockets: true,
        allowLocalBinding: true,
        httpProxyPort: 4000,
        socksProxyPort: 5000,
      },
    }
    const extraProfile = {
      toolName: 'Extra',
      fileSystemMode: 'workspace-write',
      networkMode: 'allow',
      additionalDenyPatterns: ['/tmp/private'],
      additionalAllowPatterns: ['/workspace/cache'],
    }
    const networkDenyProfile = {
      toolName: 'NetworkDeny',
      fileSystemMode: 'workspace-write',
      networkMode: 'deny',
    }
    const restrictedNetworkProfile = {
      toolName: 'RestrictedNetwork',
      fileSystemMode: 'workspace-write',
      networkMode: 'allow-with-restrictions',
    }
    function maybeMergeProfile(toolName, config) {
      const profile = toolName ? TOOL_PROFILES[toolName] : undefined
      return profile ? mergeProfileIntoConfig(profile, config, baseConfig) : config
    }

    const once = mergeProfileIntoConfig(extraProfile, customConfig, baseConfig)
    const twice = mergeProfileIntoConfig(extraProfile, once, baseConfig)

    const data = {
      toolNames: {
        bash: TOOL_PROFILES[BASH_TOOL_NAME]?.toolName,
        fileRead: TOOL_PROFILES[FILE_READ_TOOL_NAME]?.toolName,
        fileEdit: TOOL_PROFILES[FILE_EDIT_TOOL_NAME]?.toolName,
        webFetch: TOOL_PROFILES[WEB_FETCH_TOOL_NAME]?.toolName,
      },
      missingToolNameResult: maybeMergeProfile(undefined, customConfig),
      fileRead: mergeProfileIntoConfig(
        TOOL_PROFILES[FILE_READ_TOOL_NAME],
        customConfig,
        baseConfig,
      ),
      webFetch: mergeProfileIntoConfig(
        TOOL_PROFILES[WEB_FETCH_TOOL_NAME],
        customConfig,
        baseConfig,
      ),
      bash: mergeProfileIntoConfig(
        TOOL_PROFILES[BASH_TOOL_NAME],
        customConfig,
        baseConfig,
      ),
      fileEdit: mergeProfileIntoConfig(
        TOOL_PROFILES[FILE_EDIT_TOOL_NAME],
        customConfig,
        baseConfig,
      ),
      undefinedCustom: mergeProfileIntoConfig(
        TOOL_PROFILES[FILE_READ_TOOL_NAME],
        undefined,
        baseConfig,
      ),
      extraOnce: once,
      extraTwice: twice,
      networkDeny: mergeProfileIntoConfig(
        networkDenyProfile,
        customConfig,
        baseConfig,
      ),
      restrictedNetwork: mergeProfileIntoConfig(
        restrictedNetworkProfile,
        customConfig,
        baseConfig,
      ),
    }

    process.stdout.write(JSON.stringify(data))
  `

  const result = spawnSync('bun', ['--eval', script], {
    cwd: getProfileFixtureRoot(),
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  cachedProbe = JSON.parse(result.stdout)
  return cachedProbe
}

test('missing tool name leaves customConfig unchanged', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.missingToolNameResult, {
    filesystem: {
      denyRead: ['/secret'],
      allowRead: ['/workspace/project'],
      allowWrite: ['/workspace/project'],
      denyWrite: ['/workspace/project/.git/hooks'],
    },
    network: {
      allowedDomains: ['github.com'],
      deniedDomains: ['malware.example.com'],
      allowUnixSockets: ['/tmp/custom.sock'],
      allowAllUnixSockets: true,
      allowLocalBinding: true,
      httpProxyPort: 4000,
      socksProxyPort: 5000,
    },
  })
})

test('TOOL_PROFILES includes all required tool constants', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.toolNames, {
    bash: 'Bash',
    fileRead: 'Read',
    fileEdit: 'Edit',
    webFetch: 'WebFetch',
  })
})

test('FILE_READ profile clears write allowlist', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.fileRead.filesystem.allowWrite, [])
})

test('FILE_READ profile denies network with an empty allowlist', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.fileRead.network.allowedDomains, [])
  assert.deepEqual(data.fileRead.network.allowUnixSockets, [])
  assert.equal(data.fileRead.network.allowAllUnixSockets, false)
  assert.equal(data.fileRead.network.allowLocalBinding, false)
  assert.equal('httpProxyPort' in data.fileRead.network, false)
  assert.equal('socksProxyPort' in data.fileRead.network, false)
})

test('WEB_FETCH profile denies filesystem reads from root', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.webFetch.filesystem.denyRead, ['/'])
  assert.deepEqual(data.webFetch.filesystem.allowRead, [])
})

test('WEB_FETCH profile clears write allowlist', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.webFetch.filesystem.allowWrite, [])
})

test('BASH profile preserves workspace write paths', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.bash.filesystem.allowWrite, [
    '/workspace',
    '/workspace/project',
  ])
})

test('FILE_EDIT profile preserves workspace writes and denies network', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.fileEdit.filesystem.allowWrite, [
    '/workspace',
    '/workspace/project',
  ])
  assert.deepEqual(data.fileEdit.network.allowedDomains, [])
  assert.deepEqual(data.fileEdit.network.allowUnixSockets, [])
})

test('additionalDenyPatterns append to denyRead', () => {
  const data = runProfileProbe()

  assert.ok(data.extraOnce.filesystem.denyRead.includes('/tmp/private'))
})

test('additionalAllowPatterns append to allowWrite', () => {
  const data = runProfileProbe()

  assert.ok(data.extraOnce.filesystem.allowWrite.includes('/workspace/cache'))
  assert.equal(
    data.extraOnce.filesystem.denyWrite.includes('/workspace/cache'),
    false,
  )
})

test('mergeProfileIntoConfig accepts undefined customConfig', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.undefinedCustom.filesystem.allowWrite, [])
  assert.deepEqual(data.undefinedCustom.filesystem.denyRead, ['/private'])
})

test('mergeProfileIntoConfig is idempotent for repeated profile application', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.extraTwice, data.extraOnce)
})

test('network deny profile clears all network allowances', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.networkDeny.network.allowedDomains, [])
  assert.deepEqual(data.networkDeny.network.allowUnixSockets, [])
  assert.equal(data.networkDeny.network.allowAllUnixSockets, false)
  assert.equal(data.networkDeny.network.allowLocalBinding, false)
  assert.equal('httpProxyPort' in data.networkDeny.network, false)
  assert.equal('socksProxyPort' in data.networkDeny.network, false)
})

test('allow-with-restrictions preserves existing allowlist', () => {
  const data = runProfileProbe()

  assert.deepEqual(data.restrictedNetwork.network.allowedDomains, [
    'api.deepseek.com',
    'github.com',
  ])
})
