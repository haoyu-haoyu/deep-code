import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const harnessDir = dirname(fileURLToPath(import.meta.url))

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createDefaultSandboxConfig() {
  return {
    filesystem: {
      read: {
        denyOnly: [],
        allowWithinDeny: [],
      },
      write: {
        allowOnly: [],
        denyWithinAllow: [],
      },
    },
    network: {},
    excludedCommands: [],
  }
}

function createDefaultSandboxSettings() {
  return {
    enabled: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    failIfUnavailable: true,
  }
}

function mergeSandboxConfig(base = createDefaultSandboxConfig(), options = {}) {
  const defaults = createDefaultSandboxConfig()
  const current = cloneJson(base) ?? defaults
  const {
    enabled: _enabled,
    autoAllowBashIfSandboxed: _autoAllowBashIfSandboxed,
    allowUnsandboxedCommands: _allowUnsandboxedCommands,
    failIfUnavailable: _failIfUnavailable,
    ...next
  } = cloneJson(options) ?? {}

  return {
    ...defaults,
    ...current,
    ...next,
    filesystem: {
      ...defaults.filesystem,
      ...current.filesystem,
      ...next.filesystem,
      read: {
        ...defaults.filesystem.read,
        ...current.filesystem?.read,
        ...next.filesystem?.read,
      },
      write: {
        ...defaults.filesystem.write,
        ...current.filesystem?.write,
        ...next.filesystem?.write,
      },
    },
    network: {
      ...defaults.network,
      ...current.network,
      ...next.network,
    },
    excludedCommands: cloneJson(
      next.excludedCommands ?? current.excludedCommands ?? defaults.excludedCommands,
    ),
  }
}

function createViolationStore() {
  let violations = []
  let totalCount = 0
  const maxSize = 100
  const listeners = new Set()

  const notifyListeners = () => {
    const snapshot = [...violations]
    for (const listener of listeners) listener(snapshot)
  }

  return {
    get violations() {
      return violations
    },
    addViolation(violation) {
      violations.push(violation)
      totalCount += 1
      if (violations.length > maxSize) {
        violations = violations.slice(-maxSize)
      }
      notifyListeners()
    },
    add(violation) {
      this.addViolation(violation)
    },
    clear() {
      violations = []
      notifyListeners()
    },
    getViolations(limit) {
      if (limit === undefined) return [...violations]
      return violations.slice(-limit)
    },
    getCount() {
      return violations.length
    },
    getTotalCount() {
      return totalCount
    },
    getViolationsForCommand(command) {
      return violations.filter(violation => violation.command === command)
    },
    getAll() {
      return violations.map(violation => ({ ...violation }))
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(this.getViolations())
      return () => listeners.delete(listener)
    },
  }
}

export function createMockBaseSandboxManager() {
  let initialized = false
  let currentConfig = createDefaultSandboxConfig()
  let settings = createDefaultSandboxSettings()
  const wrappedCommands = []
  const violationStore = createViolationStore()

  return {
    wrappedCommands,

    async initialize(_sandboxAskCallback) {
      initialized = true
    },

    isInitialized() {
      return initialized
    },

    isSupportedPlatform() {
      return true
    },

    isPlatformInEnabledList() {
      return true
    },

    getSandboxUnavailableReason() {
      return undefined
    },

    isSandboxingEnabled() {
      return settings.enabled
    },

    isSandboxEnabledInSettings() {
      return settings.enabled
    },

    checkDependencies() {
      return { errors: [], warnings: [] }
    },

    isAutoAllowBashIfSandboxedEnabled() {
      return settings.autoAllowBashIfSandboxed
    },

    areUnsandboxedCommandsAllowed() {
      return settings.allowUnsandboxedCommands
    },

    isSandboxRequired() {
      return settings.enabled && settings.failIfUnavailable
    },

    areSandboxSettingsLockedByPolicy() {
      return false
    },

    async setSandboxSettings(options = {}) {
      if (options.enabled !== undefined) settings.enabled = options.enabled
      if (options.autoAllowBashIfSandboxed !== undefined) {
        settings.autoAllowBashIfSandboxed = options.autoAllowBashIfSandboxed
      }
      if (options.allowUnsandboxedCommands !== undefined) {
        settings.allowUnsandboxedCommands = options.allowUnsandboxedCommands
      }
      if (options.failIfUnavailable !== undefined) {
        settings.failIfUnavailable = options.failIfUnavailable
      }
      currentConfig = mergeSandboxConfig(currentConfig, options)
    },

    getFsReadConfig() {
      return cloneJson(currentConfig.filesystem.read)
    },

    getFsWriteConfig() {
      return cloneJson(currentConfig.filesystem.write)
    },

    getNetworkRestrictionConfig() {
      return cloneJson(currentConfig.network)
    },

    getAllowUnixSockets() {
      return currentConfig.network.allowUnixSockets
    },

    getAllowLocalBinding() {
      return currentConfig.network.allowLocalBinding
    },

    getIgnoreViolations() {
      return cloneJson(currentConfig.ignoreViolations)
    },

    getEnableWeakerNestedSandbox() {
      return currentConfig.enableWeakerNestedSandbox
    },

    getExcludedCommands() {
      return cloneJson(currentConfig.excludedCommands ?? [])
    },

    getProxyPort() {
      return currentConfig.network?.proxyPort
    },

    getSocksProxyPort() {
      return currentConfig.network?.socksProxyPort
    },

    getLinuxHttpSocketPath() {
      return currentConfig.network?.linuxHttpSocketPath
    },

    getLinuxSocksSocketPath() {
      return currentConfig.network?.linuxSocksSocketPath
    },

    async waitForNetworkInitialization() {
      return true
    },

    async wrapWithSandbox(command, binShell, customConfig, abortSignal) {
      wrappedCommands.push({
        command,
        binShell,
        customConfig: cloneJson(customConfig),
        aborted: abortSignal?.aborted ?? false,
      })
      return command
    },

    cleanupAfterCommand() {},

    getSandboxViolationStore() {
      return violationStore
    },

    annotateStderrWithSandboxFailures(_command, stderr) {
      return stderr
    },

    getLinuxGlobPatternWarnings() {
      return []
    },

    refreshConfig() {},

    async reset() {
      initialized = false
      currentConfig = createDefaultSandboxConfig()
      settings = createDefaultSandboxSettings()
      wrappedCommands.length = 0
      violationStore.clear()
    },
  }
}

export function fixture(name) {
  return readFile(join(harnessDir, 'fixtures', name), 'utf8')
}

export async function spawnTestCommand(cmd, sandboxConfig = {}) {
  const command = Array.isArray(cmd) ? cmd[0] : cmd
  const args = Array.isArray(cmd) ? cmd.slice(1) : []
  assert.equal(typeof command, 'string', 'cmd must be a string or string array')

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: sandboxConfig.cwd,
      env: { ...process.env, ...sandboxConfig.env },
      shell: typeof cmd === 'string',
      signal: sandboxConfig.signal,
      timeout: sandboxConfig.timeoutMs ?? 5000,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
}

export function expectViolation(violation, matchers) {
  assert.ok(violation, 'expected violation to be present')

  for (const [key, expected] of Object.entries(matchers)) {
    const actual = violation[key]
    if (expected instanceof RegExp) {
      assert.match(String(actual), expected, `expected ${key} to match`)
    } else if (typeof expected === 'function') {
      assert.ok(expected(actual), `expected ${key} predicate to pass`)
    } else {
      assert.deepEqual(actual, expected, `expected ${key} to equal matcher`)
    }
  }
}
