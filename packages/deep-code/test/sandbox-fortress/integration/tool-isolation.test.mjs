import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMockBaseSandboxManager } from '../harness.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const profileSourcePath = resolve(
  packageRoot,
  'src/sandbox-fortress/adapter/per-tool-profiles.ts',
)

let profileFixtureRoot

function writeFixtureFile(relativePath, content) {
  const target = join(profileFixtureRoot, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function getProfileFixtureRoot() {
  if (profileFixtureRoot) return profileFixtureRoot

  profileFixtureRoot = mkdtempSync(
    join(tmpdir(), 'deepcode-tool-isolation-'),
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

function runIntegrationProbe() {
  const script = String.raw`
    import {
      mergeProfileIntoConfig,
      TOOL_PROFILES,
    } from './src/sandbox-fortress/adapter/per-tool-profiles.ts'
    import { BASH_TOOL_NAME } from './src/tools/BashTool/toolName.js'
    import { FILE_READ_TOOL_NAME } from './src/tools/FileReadTool/prompt.js'
    import { WEB_FETCH_TOOL_NAME } from './src/tools/WebFetchTool/prompt.js'

    const baseConfig = {
      filesystem: {
        denyRead: [],
        allowRead: [],
        allowWrite: ['/workspace'],
        denyWrite: [],
      },
      network: {
        allowedDomains: ['api.deepseek.com'],
        deniedDomains: [],
      },
    }

    const fileReadConfig = mergeProfileIntoConfig(
      TOOL_PROFILES[FILE_READ_TOOL_NAME],
      undefined,
      baseConfig,
    )
    const webFetchConfig = mergeProfileIntoConfig(
      TOOL_PROFILES[WEB_FETCH_TOOL_NAME],
      undefined,
      baseConfig,
    )
    const bashConfig = mergeProfileIntoConfig(
      TOOL_PROFILES[BASH_TOOL_NAME],
      undefined,
      baseConfig,
    )

    process.stdout.write(JSON.stringify({
      fileReadConfig,
      webFetchConfig,
      bashConfig,
    }))
  `

  const result = spawnSync('bun', ['--eval', script], {
    cwd: getProfileFixtureRoot(),
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('FileRead profile rejects workspace writes while Bash keeps baseline writes', async () => {
  const manager = createMockBaseSandboxManager()
  const { fileReadConfig, bashConfig } = runIntegrationProbe()

  await manager.wrapWithSandbox(
    'printf data > /workspace/created-by-read',
    '/bin/sh',
    fileReadConfig,
  )
  await manager.wrapWithSandbox(
    'printf data > /workspace/created-by-bash',
    '/bin/sh',
    bashConfig,
  )

  assert.deepEqual(
    manager.wrappedCommands[0].customConfig.filesystem.allowWrite,
    [],
  )
  assert.deepEqual(
    manager.wrappedCommands[1].customConfig.filesystem.allowWrite,
    ['/workspace'],
  )
})

test('WebFetch profile rejects project file reads and writes', async () => {
  const manager = createMockBaseSandboxManager()
  const { webFetchConfig } = runIntegrationProbe()

  await manager.wrapWithSandbox(
    'cat /workspace/package.json',
    '/bin/sh',
    webFetchConfig,
  )

  assert.deepEqual(
    manager.wrappedCommands[0].customConfig.filesystem.denyRead,
    ['/'],
  )
  assert.deepEqual(
    manager.wrappedCommands[0].customConfig.filesystem.allowRead,
    [],
  )
  assert.deepEqual(
    manager.wrappedCommands[0].customConfig.filesystem.allowWrite,
    [],
  )
})

test('Bash profile leaves wrapped command shape unchanged except explicit config', async () => {
  const manager = createMockBaseSandboxManager()
  const { bashConfig } = runIntegrationProbe()

  await manager.wrapWithSandbox('pwd', '/bin/sh', bashConfig)

  assert.deepEqual(manager.wrappedCommands, [
    {
      command: 'pwd',
      binShell: '/bin/sh',
      customConfig: bashConfig,
      aborted: false,
    },
  ])
})
