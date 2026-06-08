import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMockBaseSandboxManager } from '../harness.mjs'

export { test }

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const legacySourcePath = resolve(
  packageRoot,
  'src',
  'sandbox-fortress/adapter/legacy.ts',
)
// legacy.ts imports the pure availability core (../sandboxAvailability.mjs); it
// has no deps of its own, so stage the REAL file into the fixture.
const sandboxAvailabilitySourcePath = resolve(
  packageRoot,
  'src/sandbox-fortress/sandboxAvailability.mjs',
)
// legacy.ts also imports the pure network-decision core (../networkDecision.mjs).
const networkDecisionSourcePath = resolve(
  packageRoot,
  'src/sandbox-fortress/networkDecision.mjs',
)
// legacy.ts shares hasUnfaithfulGlob from the pure projector (../rule-engine/fsProjector.mjs).
const fsProjectorSourcePath = resolve(
  packageRoot,
  'src/sandbox-fortress/rule-engine/fsProjector.mjs',
)
const harnessSourcePath = resolve(
  packageRoot,
  'test/sandbox-fortress/harness.mjs',
)

function writeFixtureFile(root, relativePath, content) {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function writeLegacyFixture(root) {
  assert.equal(typeof createMockBaseSandboxManager, 'function')

  const legacyTarget = join(
    root,
    'src/sandbox-fortress/adapter/legacy.ts',
  )
  mkdirSync(dirname(legacyTarget), { recursive: true })
  copyFileSync(legacySourcePath, legacyTarget)

  // The pure availability core legacy.ts now delegates to.
  copyFileSync(
    sandboxAvailabilitySourcePath,
    join(root, 'src/sandbox-fortress/sandboxAvailability.mjs'),
  )
  // The pure network-decision core legacy.ts's network callback delegates to.
  copyFileSync(
    networkDecisionSourcePath,
    join(root, 'src/sandbox-fortress/networkDecision.mjs'),
  )
  // The pure projector legacy.ts shares hasUnfaithfulGlob from (a leaf, no deps). Its dir
  // (rule-engine/) is new to the fixture, so create it before copyFileSync (which won't).
  const fsProjectorTarget = join(root, 'src/sandbox-fortress/rule-engine/fsProjector.mjs')
  mkdirSync(dirname(fsProjectorTarget), { recursive: true })
  copyFileSync(fsProjectorSourcePath, fsProjectorTarget)

  const harnessTarget = join(root, 'test/sandbox-fortress/harness.mjs')
  mkdirSync(dirname(harnessTarget), { recursive: true })
  copyFileSync(harnessSourcePath, harnessTarget)

  writeFixtureFile(root, 'package.json', '{"type":"module"}\n')
  writeFixtureFile(
    root,
    'node_modules/lodash-es/package.json',
    '{"type":"module"}\n',
  )
  writeFixtureFile(
    root,
    'node_modules/lodash-es/index.js',
    `export function memoize(fn) {
      const cache = new Map()
      function memoized(...args) {
        const key = JSON.stringify(args)
        if (!cache.has(key)) cache.set(key, fn(...args))
        return cache.get(key)
      }
      memoized.cache = { clear() { cache.clear() } }
      return memoized
    }
    `,
  )
  writeFixtureFile(
    root,
    'node_modules/@anthropic-ai/sandbox-runtime/package.json',
    '{"type":"module"}\n',
  )
  writeFixtureFile(
    root,
    'node_modules/@anthropic-ai/sandbox-runtime/index.js',
    `import { createMockBaseSandboxManager } from '../../../test/sandbox-fortress/harness.mjs'

    const mock = createMockBaseSandboxManager()
    let initializeFailure
    export const __baseSandboxState = {
      initializeCalls: [],
      updateConfigs: [],
      resetCalls: 0,
      lastCallback: undefined,
    }
    export function __getMockBaseSandboxManager() {
      return mock
    }
    export function __failNextInitialize(message = 'boom') {
      initializeFailure = new Error(message)
    }
    export class SandboxViolationStore {
      constructor() {
        this.violations = []
      }
      add(event) {
        this.violations.push(event)
      }
      getAll() {
        return [...this.violations]
      }
      clear() {
        this.violations.length = 0
      }
    }
    export const SandboxRuntimeConfigSchema = {
      parse(config) {
        if (!config || typeof config !== 'object' || !config.network || !config.filesystem) {
          throw new Error('Invalid SandboxRuntimeConfig')
        }
        return config
      },
      safeParse(config) {
        try {
          return { success: true, data: this.parse(config) }
        } catch (error) {
          return { success: false, error }
        }
      },
    }
    export class SandboxManager {
      static checkDependencies(...args) { return mock.checkDependencies(...args) }
      static isSupportedPlatform(...args) { return mock.isSupportedPlatform(...args) }
      static async initialize(config, callback) {
        __baseSandboxState.initializeCalls.push({ config, hasCallback: Boolean(callback) })
        __baseSandboxState.lastCallback = callback
        if (initializeFailure) {
          const error = initializeFailure
          initializeFailure = undefined
          throw error
        }
        return mock.initialize(callback)
      }
      static updateConfig(config) { __baseSandboxState.updateConfigs.push(config) }
      static async reset() {
        __baseSandboxState.resetCalls += 1
        return mock.reset()
      }
      static async wrapWithSandbox(...args) { return mock.wrapWithSandbox(...args) }
      static cleanupAfterCommand(...args) { return mock.cleanupAfterCommand(...args) }
      static getFsReadConfig(...args) { return mock.getFsReadConfig(...args) }
      static getFsWriteConfig(...args) { return mock.getFsWriteConfig(...args) }
      static getNetworkRestrictionConfig(...args) { return mock.getNetworkRestrictionConfig(...args) }
      static getIgnoreViolations(...args) { return mock.getIgnoreViolations(...args) }
      static getAllowUnixSockets(...args) { return mock.getAllowUnixSockets(...args) }
      static getAllowLocalBinding(...args) { return mock.getAllowLocalBinding(...args) }
      static getEnableWeakerNestedSandbox(...args) { return mock.getEnableWeakerNestedSandbox(...args) }
      static getProxyPort(...args) { return mock.getProxyPort(...args) }
      static getSocksProxyPort(...args) { return mock.getSocksProxyPort(...args) }
      static getLinuxHttpSocketPath(...args) { return mock.getLinuxHttpSocketPath(...args) }
      static getLinuxSocksSocketPath(...args) { return mock.getLinuxSocksSocketPath(...args) }
      static waitForNetworkInitialization(...args) { return mock.waitForNetworkInitialization(...args) }
      static getSandboxViolationStore(...args) { return mock.getSandboxViolationStore(...args) }
      static annotateStderrWithSandboxFailures(...args) { return mock.annotateStderrWithSandboxFailures(...args) }
    }
    `,
  )
  writeFixtureFile(root, 'src/bootstrap/state.js', bootstrapStubSource())
  writeFixtureFile(
    root,
    'src/utils/settings/constants.js',
    settingsConstantsStubSource(),
  )
  writeFixtureFile(root, 'src/utils/settings/settings.js', settingsStubSource())
  writeFixtureFile(
    root,
    'src/utils/settings/changeDetector.js',
    changeDetectorStubSource(),
  )
  writeFixtureFile(
    root,
    'src/utils/settings/managedPath.js',
    "export function getManagedSettingsDropInDir() { return '/settings/policy/drop-ins' }\n",
  )
  writeFixtureFile(root, 'src/utils/path.js', pathStubSource())
  writeFixtureFile(root, 'src/utils/platform.js', platformStubSource())
  writeFixtureFile(
    root,
    'src/utils/debug.js',
    'export function logForDebugging() {}\n',
  )
  writeFixtureFile(
    root,
    'src/utils/errors.js',
    'export function errorMessage(error) { return error instanceof Error ? error.message : String(error) }\n',
  )
  writeFixtureFile(
    root,
    'src/utils/permissions/filesystem.js',
    "export function getClaudeTempDir() { return '/tmp/deepcode-temp' }\n",
  )
  writeFixtureFile(
    root,
    'src/utils/ripgrep.js',
    "export function ripgrepCommand() { return { rgPath: '/usr/bin/rg', rgArgs: ['--no-config'], argv0: 'rg' } }\n",
  )
  writeFixtureFile(
    root,
    'src/sandbox-fortress/adapter/per-tool-profiles.js',
    `export const TOOL_PROFILES = {}
    export function mergeProfileIntoConfig(_profile, customConfig = {}, baseConfig = {}) {
      return { ...baseConfig, ...customConfig }
    }
    `,
  )
  writeToolConstantFixtures(root)
}

function writeToolConstantFixtures(root) {
  for (const [relativePath, exportName, value] of [
    ['tools/BashTool/toolName.js', 'BASH_TOOL_NAME', 'Bash'],
    ['tools/FileEditTool/constants.js', 'FILE_EDIT_TOOL_NAME', 'Edit'],
    ['tools/FileReadTool/prompt.js', 'FILE_READ_TOOL_NAME', 'Read'],
    ['tools/WebFetchTool/prompt.js', 'WEB_FETCH_TOOL_NAME', 'WebFetch'],
  ]) {
    const source = `export const ${exportName} = '${value}'\n`
    writeFixtureFile(root, `src/${relativePath}`, source)
    writeFixtureFile(root, `node_modules/src/${relativePath}`, source)
  }
}

function bootstrapStubSource() {
  return `let cwd = '/workspace/project'
    let originalCwd = '/workspace/project'
    let additionalDirectories = []
    export function __setCwdState(nextCwd, nextOriginalCwd = nextCwd) {
      cwd = nextCwd
      originalCwd = nextOriginalCwd
    }
    export function __setAdditionalDirectoriesForClaudeMd(paths) {
      additionalDirectories = paths
    }
    export function getAdditionalDirectoriesForClaudeMd() {
      return additionalDirectories
    }
    export function getCwdState() { return cwd }
    export function getOriginalCwd() { return originalCwd }
    `
}

function settingsConstantsStubSource() {
  return `export const SETTING_SOURCES = [
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ]
    `
}

function settingsStubSource() {
  return `const roots = {
      userSettings: '/settings/user',
      projectSettings: '/workspace/project/.claude',
      localSettings: '/workspace/project/.claude',
      flagSettings: '/settings/flag',
      policySettings: '/settings/policy',
    }
    let mergedSettings = { permissions: {}, sandbox: {} }
    let settingsBySource = Object.fromEntries(Object.keys(roots).map(source => [source, {}]))
    const throwingSources = new Set()
    export const __settingsUpdates = []
    export function __resetSettings() {
      mergedSettings = { permissions: {}, sandbox: {} }
      settingsBySource = Object.fromEntries(Object.keys(roots).map(source => [source, {}]))
      throwingSources.clear()
      __settingsUpdates.length = 0
    }
    export function __setMergedSettings(settings) { mergedSettings = settings }
    export function __setSourceSettings(source, settings) { settingsBySource[source] = settings }
    export function __setSettingsRoot(source, root) { roots[source] = root }
    export function __throwForSource(source) { throwingSources.add(source) }
    function mergeSettings(base = {}, patch = {}) {
      const out = { ...base, ...patch }
      if (base.sandbox || patch.sandbox) out.sandbox = { ...(base.sandbox || {}), ...(patch.sandbox || {}) }
      if (base.permissions || patch.permissions) out.permissions = { ...(base.permissions || {}), ...(patch.permissions || {}) }
      return out
    }
    export function getSettingsForSource(source) {
      if (throwingSources.has(source)) throw new Error('settings unavailable')
      return settingsBySource[source]
    }
    export function getSettings_DEPRECATED() { return mergedSettings }
    export function getInitialSettings() { return mergedSettings }
    export function getSettingsRootPathForSource(source) { return roots[source] }
    export function getSettingsFilePathForSource(source) { return roots[source] ? roots[source] + '/settings.json' : undefined }
    export function updateSettingsForSource(source, patch) {
      settingsBySource[source] = mergeSettings(settingsBySource[source], patch)
      __settingsUpdates.push({ source, patch })
    }
    `
}

function changeDetectorStubSource() {
  return `const subscribers = new Set()
    export const __changeDetectorState = { subscribeCount: 0, cleanupCount: 0 }
    export function __emitSettingsChange() {
      for (const subscriber of [...subscribers]) subscriber()
    }
    export const settingsChangeDetector = {
      subscribe(callback) {
        subscribers.add(callback)
        __changeDetectorState.subscribeCount += 1
        return () => {
          subscribers.delete(callback)
          __changeDetectorState.cleanupCount += 1
        }
      },
    }
    `
}

function pathStubSource() {
  return `import { homedir } from 'node:os'
    import { isAbsolute, join, normalize, resolve } from 'node:path'
    export function expandPath(path, baseDir = '/workspace/project') {
      if (typeof path !== 'string') throw new TypeError('Path must be a string')
      if (typeof baseDir !== 'string') throw new TypeError('Base directory must be a string')
      if (path.includes('\\0') || baseDir.includes('\\0')) throw new Error('Path contains null bytes')
      const trimmed = path.trim()
      if (!trimmed) return normalize(baseDir)
      if (trimmed === '~') return homedir()
      if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
      if (isAbsolute(trimmed)) return normalize(trimmed)
      return resolve(baseDir, trimmed)
    }
    `
}

function platformStubSource() {
  return `let platform = 'linux'
    export function __setPlatform(value) { platform = value }
    export function getPlatform() { return platform }
    `
}

function runLegacyProbeSubprocess(probe) {
  const root = mkdtempSync(join(tmpdir(), 'deepcode-adapter-legacy-'))
  writeLegacyFixture(root)
  const result = spawnSync('bun', ['--eval', probe], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

export async function runLegacyProbe(probe) {
  return runLegacyProbeSubprocess(probe)
}

const isDirectTestFile =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectTestFile) {
  test('resolves permission-rule and filesystem path patterns', async () => {
    const data = await runLegacyProbe(`
      import {
        resolvePathPatternForSandbox,
        resolveSandboxFilesystemPath,
      } from './src/sandbox-fortress/adapter/legacy.ts'
      import { __setSettingsRoot } from './src/utils/settings/settings.js'

      __setSettingsRoot('projectSettings', '/workspace/project/.claude')

      const result = {
        absoluteEscape: resolvePathPatternForSandbox('//etc/hosts', 'projectSettings'),
        settingsRelative: resolvePathPatternForSandbox('/rules/**', 'projectSettings'),
        tildePassThrough: resolvePathPatternForSandbox('~/cache', 'projectSettings'),
        relativePassThrough: resolvePathPatternForSandbox('unicode/资料.txt', 'projectSettings'),
        fsAbsolute: resolveSandboxFilesystemPath('/Users/alice/.cargo', 'projectSettings'),
        fsLegacyEscape: resolveSandboxFilesystemPath('//Users/alice/.cargo', 'projectSettings'),
        fsRelative: resolveSandboxFilesystemPath('logs/资料.txt', 'projectSettings'),
        fsEmpty: resolveSandboxFilesystemPath('   ', 'projectSettings'),
      }

      process.stdout.write(JSON.stringify(result))
    `)

    assert.deepEqual(data, {
      absoluteEscape: '/etc/hosts',
      settingsRelative: '/workspace/project/.claude/rules/**',
      tildePassThrough: '~/cache',
      relativePassThrough: 'unicode/资料.txt',
      fsAbsolute: '/Users/alice/.cargo',
      fsLegacyEscape: '/Users/alice/.cargo',
      fsRelative: '/workspace/project/.claude/logs/资料.txt',
      fsEmpty: '/workspace/project/.claude',
    })
  })

  test('rejects malformed path pattern inputs', async () => {
    const data = await runLegacyProbe(`
      import {
        resolvePathPatternForSandbox,
        resolveSandboxFilesystemPath,
      } from './src/sandbox-fortress/adapter/legacy.ts'

      function capture(fn) {
        try {
          fn()
          return 'NO_THROW'
        } catch (error) {
          return error.name + ':' + error.message
        }
      }

      process.stdout.write(JSON.stringify({
        permissionNull: capture(() => resolvePathPatternForSandbox(null, 'projectSettings')),
        filesystemObject: capture(() => resolveSandboxFilesystemPath({ value: 'x' }, 'projectSettings')),
      }))
    `)

    assert.match(data.permissionNull, /^TypeError:/)
    assert.match(data.filesystemObject, /^TypeError:/)
  })
}
