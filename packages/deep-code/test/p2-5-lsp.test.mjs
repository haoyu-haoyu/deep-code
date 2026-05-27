import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
} from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import {
  createLSPClientCore,
  createLSPServerInstanceCore,
  createLSPServerManagerCore,
} from '../src/services/lsp/core.mjs'
import {
  notifyAndCollectDiagnosticsCore,
} from '../src/services/lsp/postEditDiagnostics-core.mjs'
import {
  mergeBuiltInLspServers,
  resolveLspServer,
} from '../src/services/lsp/registry.mjs'

test('LSP client performs initialize + initialized handshake', async () => {
  const server = await createFakeLspServer()
  const client = createTestClient('fake-ts')

  try {
    await client.start(process.execPath, [server.scriptPath], {
      env: server.env(),
    })
    const result = await client.initialize({ processId: process.pid })
    await server.waitForMethod('notification:initialized')

    assert.equal(result.capabilities.definitionProvider, true)
    assert.equal(client.isInitialized, true)
    assert.deepEqual(await server.methods(), [
      'request:initialize',
      'notification:initialized',
    ])
  } finally {
    await client.stop().catch(() => {})
  }
})

test('LSP manager opens a new file before sending didChange', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-manager-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer()
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    await manager.changeFile(filePath, 'const value = 1\n')
    await manager.changeFile(filePath, 'const value = 2\n')
    await server.waitForMethod('notification:textDocument/didChange')

    const methods = await server.methods()
    assert.ok(
      methods.indexOf('notification:textDocument/didOpen') >= 0,
      methods.join(', '),
    )
    assert.ok(
      methods.indexOf('notification:textDocument/didChange') >
        methods.indexOf('notification:textDocument/didOpen'),
      methods.join(', '),
    )
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('LSP manager sends didChange after an opened file changes', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-change-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer()
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    await manager.openFile(filePath, 'const value = 1\n')
    await manager.changeFile(filePath, 'const value = 2\n')
    await server.waitForMethod('notification:textDocument/didChange')

    const methods = await server.methods()
    assert.equal(methods.includes('notification:textDocument/didChange'), true)
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('LSP manager sends didSave notification', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-save-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer()
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    await manager.openFile(filePath, 'const value = 1\n')
    await manager.saveFile(filePath)
    await server.waitForMethod('notification:textDocument/didSave')

    assert.equal(
      (await server.methods()).includes('notification:textDocument/didSave'),
      true,
    )
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('LSP client dispatches publishDiagnostics notifications', async () => {
  const server = await createFakeLspServer({ behavior: 'diagnostics-after-init' })
  const client = createTestClient('fake-ts')
  const diagnostics = []

  client.onNotification('textDocument/publishDiagnostics', params => {
    diagnostics.push(params)
  })

  try {
    await client.start(process.execPath, [server.scriptPath], {
      env: server.env(),
    })
    await client.initialize({ processId: process.pid })

    await waitFor(() => diagnostics.length === 1)
    assert.equal(diagnostics[0].diagnostics[0].message, 'fake diagnostic')
  } finally {
    await client.stop().catch(() => {})
  }
})

test('LSP client reports missing binary without crashing the process', async () => {
  const client = createTestClient('missing-binary')

  await assert.rejects(
    () =>
      client.start('__deepcode_lsp_binary_that_does_not_exist__', [], {
        env: {},
      }),
    /ENOENT|not found|failed to start/i,
  )
  assert.equal(client.isInitialized, false)
  await client.stop().catch(() => {})
})

test('LSP server instance marks state error after server crash', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-crash-'))
  const server = await createFakeLspServer({ behavior: 'crash-after-init' })
  const instance = createTestServerInstance(
    'fake-ts',
    serverConfig(server, workspaceRoot),
  )

  await instance.start()
  await waitFor(() => instance.state === 'error')

  assert.equal(instance.state, 'error')
  assert.match(instance.lastError.message, /crashed/i)
  await instance.stop().catch(() => {})
})

test('LSP client shutdown sends shutdown and exit then clears state', async () => {
  const server = await createFakeLspServer()
  const client = createTestClient('fake-ts')

  await client.start(process.execPath, [server.scriptPath], {
    env: server.env(),
  })
  await client.initialize({ processId: process.pid })
  await client.stop()

  const methods = await server.methods()
  assert.equal(methods.includes('request:shutdown'), true)
  assert.equal(methods.includes('notification:exit'), true)
  assert.equal(client.isInitialized, false)
})

test('LSP registry resolves .ts to built-in TypeScript server when available', () => {
  const config = resolveLspServer('.ts', {}, { isCommandAvailable: () => true })

  assert.equal(config.command, 'typescript-language-server')
  assert.deepEqual(config.args, ['--stdio'])
  assert.equal(config.extensionToLanguage['.ts'], 'typescript')
})

test('LSP registry resolves .tsx to built-in TypeScript server when available', () => {
  const config = resolveLspServer('.tsx', {}, { isCommandAvailable: () => true })

  assert.equal(config.command, 'typescript-language-server')
  assert.deepEqual(config.args, ['--stdio'])
  assert.equal(config.extensionToLanguage['.tsx'], 'typescriptreact')
})

test('LSP registry leaves non-P2.5.b languages unresolved', () => {
  const options = { isCommandAvailable: () => true }

  assert.equal(resolveLspServer('.py', {}, options), undefined)
  assert.equal(resolveLspServer('.rs', {}, options), undefined)
})

test('LSP registry lets plugin servers override built-in TypeScript config', () => {
  const pluginServers = {
    'plugin:test:ts': {
      command: 'custom-ts-lsp',
      args: ['--stdio'],
      extensionToLanguage: {
        '.ts': 'typescript',
      },
      scope: 'dynamic',
      source: 'test-plugin',
    },
  }

  const config = resolveLspServer('.ts', pluginServers, {
    isCommandAvailable: () => true,
  })

  assert.equal(config.command, 'custom-ts-lsp')
  assert.equal(config.source, 'test-plugin')
})

test('LSP registry silently skips built-in TypeScript server when binary is missing', () => {
  assert.equal(
    resolveLspServer('.ts', {}, { isCommandAvailable: () => false }),
    undefined,
  )
})

test('LSP registry merges built-ins without overriding plugin-owned extensions', () => {
  const pluginServers = {
    'plugin:test:ts': {
      command: 'custom-ts-lsp',
      args: ['--stdio'],
      extensionToLanguage: {
        '.ts': 'typescript',
      },
      scope: 'dynamic',
      source: 'test-plugin',
    },
  }

  const merged = mergeBuiltInLspServers(pluginServers, {
    isCommandAvailable: () => true,
  })

  assert.equal(merged['plugin:test:ts'].command, 'custom-ts-lsp')
  assert.equal(merged['builtin:typescript'].command, 'typescript-language-server')
  assert.deepEqual(merged['builtin:typescript'].extensionToLanguage, {
    '.tsx': 'typescriptreact',
  })
})

test('post-edit diagnostics notifies change and save then collects diagnostics', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-post-edit-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer({ behavior: 'diagnostics-on-save' })
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    const result = await notifyAndCollectDiagnosticsCore({
      filePath,
      content: 'const value: string = 1\n',
      operation: 'edit',
      pollDelay: 50,
      maxDiagnostics: 10,
      lspManager: manager,
      clearDeliveredDiagnosticsForFile() {},
      formatDiagnosticsForAttachment: formatFakeDiagnostics,
      delay,
      logForDebugging() {},
      logError() {},
    })

    await server.waitForMethod('notification:textDocument/didChange')
    await server.waitForMethod('notification:textDocument/didSave')
    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0].message, 'fake diagnostic')
    assert.equal(result.truncated, false)
    assert.ok(result.elapsed >= 0)
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('post-edit diagnostics failures return empty results without throwing', async () => {
  const result = await notifyAndCollectDiagnosticsCore({
    filePath: '/tmp/demo.ts',
    content: 'broken',
    operation: 'write',
    pollDelay: 1,
    maxDiagnostics: 10,
    lspManager: {
      async ensureServerStarted() {
        throw new Error('LSP crashed')
      },
    },
    clearDeliveredDiagnosticsForFile() {},
    formatDiagnosticsForAttachment: formatFakeDiagnostics,
    delay,
    logForDebugging() {},
    logError() {},
  })

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.truncated, false)
})

test('post-edit diagnostics deduplicates and truncates collected diagnostics', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-post-dedupe-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer({
    behavior: 'duplicate-diagnostics-on-save',
  })
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    const result = await notifyAndCollectDiagnosticsCore({
      filePath,
      content: 'const value: string = 1\n',
      operation: 'edit',
      pollDelay: 50,
      maxDiagnostics: 1,
      lspManager: manager,
      clearDeliveredDiagnosticsForFile() {},
      formatDiagnosticsForAttachment: formatFakeDiagnostics,
      delay,
      logForDebugging() {},
      logError() {},
    })

    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0].message, 'fake diagnostic')
    assert.equal(result.truncated, false)
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('FileEditTool and FileWriteTool use post-edit diagnostics facade', () => {
  const editSource = readFileSync(
    new URL('../src/tools/FileEditTool/FileEditTool.ts', import.meta.url),
    'utf8',
  )
  const writeSource = readFileSync(
    new URL('../src/tools/FileWriteTool/FileWriteTool.ts', import.meta.url),
    'utf8',
  )

  assert.match(editSource, /notifyAndCollectDiagnostics/)
  assert.match(editSource, /operation:\s*'edit'/)
  assert.doesNotMatch(editSource, /getLspServerManager\(\)/)
  assert.match(writeSource, /notifyAndCollectDiagnostics/)
  assert.match(writeSource, /operation:\s*'write'/)
  assert.doesNotMatch(writeSource, /getLspServerManager\(\)/)
})

test('settings schema validates optional lsp section and strips nested unknown fields', () => {
  const source = readFileSync(
    new URL('../src/utils/settings/types.ts', import.meta.url),
    'utf8',
  )
  const lspStart = source.search(/lsp:\s*z\s*\.object\(\{/)
  assert.notEqual(lspStart, -1)
  const lspEnd = source.indexOf(
    ".describe('LSP diagnostics configuration')",
    lspStart,
  )
  assert.notEqual(lspEnd, -1)
  const lspSchema = source.slice(lspStart, lspEnd)

  assert.match(lspSchema, /enabled:\s*z\s*\.boolean\(\)\s*\.optional\(\)/)
  assert.match(
    lspSchema,
    /poll_after_edit_ms:\s*z\s*\.number\(\)\s*\.int\(\)\s*\.positive\(\)\s*\.optional\(\)/,
  )
  assert.match(
    lspSchema,
    /max_diagnostics_per_file:\s*z\s*\.number\(\)\s*\.int\(\)\s*\.positive\(\)\s*\.optional\(\)/,
  )
  assert.match(
    lspSchema,
    /include_warnings:\s*z\s*\.boolean\(\)\s*\.optional\(\)/,
  )
  assert.doesNotMatch(lspSchema, /\.passthrough\(\)/)
  assert.doesNotMatch(lspSchema, /languages:/)
})

test('LSP settings defaults merge overrides without leaking unknown fields', async () => {
  const { LSP_DEFAULTS, mergeLspConfig } = await import(
    '../src/services/lsp/defaults-core.mjs'
  )

  assert.deepEqual(mergeLspConfig({}), LSP_DEFAULTS)
  assert.deepEqual(
    mergeLspConfig({
      lsp: {
        enabled: false,
        poll_after_edit_ms: 750,
        max_diagnostics_per_file: 3,
        include_warnings: false,
        ignored_future_field: 'safe to ignore',
      },
    }),
    {
      enabled: false,
      poll_after_edit_ms: 750,
      max_diagnostics_per_file: 3,
      include_warnings: false,
    },
  )
})

test('post-edit diagnostics config gates, truncates, and filters warnings', async () => {
  const {
    LSP_DEFAULTS,
    applyLspDiagnosticConfig,
    emptyPostEditResult,
    resolvePostEditDiagnosticsConfig,
  } = await import('../src/services/lsp/defaults-core.mjs')

  const disabled = resolvePostEditDiagnosticsConfig({
    settings: { lsp: { enabled: false } },
  })
  assert.equal(disabled.enabled, false)
  assert.deepEqual(emptyPostEditResult().diagnostics, [])

  const diagnostics = [
    { message: 'type mismatch', severity: 'Error' },
    { message: 'unused import', severity: 'Warning' },
    { message: 'style hint', severity: 'Info' },
  ]

  const filtered = applyLspDiagnosticConfig(
    { diagnostics, elapsed: 5, truncated: false },
    { ...LSP_DEFAULTS, include_warnings: false },
  )
  assert.deepEqual(
    filtered.diagnostics.map(diagnostic => diagnostic.message),
    ['type mismatch'],
  )

  const truncated = applyLspDiagnosticConfig(
    { diagnostics, elapsed: 5, truncated: false },
    { ...LSP_DEFAULTS, max_diagnostics_per_file: 2 },
  )
  assert.equal(truncated.diagnostics.length, 2)
  assert.equal(truncated.truncated, true)
})

test('post-edit diagnostics facade reads centralized lsp settings before manager access', () => {
  const source = readFileSync(
    new URL('../src/services/lsp/postEditDiagnostics.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /getLspConfig\(\)/)
  assert.match(source, /if\s*\(!lspConfig\.enabled\)/)
  assert.match(source, /applyLspDiagnosticConfig/)
  assert.ok(
    source.indexOf('getLspConfig()') < source.indexOf('getLspServerManager()'),
  )
})

test('LSP activation honors lsp.enabled and ConfigTool exposes lsp.enabled only', () => {
  const managerSource = readFileSync(
    new URL('../src/services/lsp/manager.ts', import.meta.url),
    'utf8',
  )
  const configSource = readFileSync(
    new URL('../src/services/lsp/config.ts', import.meta.url),
    'utf8',
  )
  const supportedSettingsSource = readFileSync(
    new URL(
      '../src/tools/ConfigTool/supportedSettings.ts',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(managerSource, /getLspConfig\(\)\.enabled/)
  assert.match(configSource, /getLspConfig\(\)\.enabled/)
  assert.match(supportedSettingsSource, /['"]lsp\.enabled['"]:\s*\{/)
  assert.match(
    supportedSettingsSource,
    /['"]lsp\.enabled['"]:[\s\S]*type:\s*'boolean'/,
  )
  assert.doesNotMatch(supportedSettingsSource, /lsp\.poll_after_edit_ms/)
  assert.doesNotMatch(supportedSettingsSource, /lsp\.max_diagnostics_per_file/)
})

function serverConfig(server, workspaceRoot) {
  return {
    command: process.execPath,
    args: [server.scriptPath],
    env: server.env(),
    extensionToLanguage: {
      '.ts': 'typescript',
    },
    workspaceFolder: workspaceRoot,
    startupTimeout: 5_000,
    maxRestarts: 1,
  }
}

function formatFakeDiagnostics(params) {
  return [
    {
      uri: params.uri.replace(/^file:\/\//, ''),
      diagnostics: params.diagnostics.map(diag => ({
        message: diag.message,
        severity: 'Error',
        range: diag.range,
        source: diag.source,
        code: diag.code ? String(diag.code) : undefined,
      })),
    },
  ]
}

function createTestClient(serverName, onCrash) {
  return createLSPClientCore({
    serverName,
    onCrash,
    logForDebugging() {},
    logError() {},
    subprocessEnv: () => process.env,
  })
}

function createTestServerInstance(name, config) {
  return createLSPServerInstanceCore({
    name,
    config,
    createLSPClient: createTestClient,
    getCwd: () => config.workspaceFolder || process.cwd(),
    sleep: delay,
    logForDebugging() {},
    logError() {},
    errorMessage: error =>
      error instanceof Error ? error.message : String(error),
  })
}

function createTestManager(serverConfigs) {
  return createLSPServerManagerCore({
    serverConfigs,
    createServerInstance: createTestServerInstance,
    logForDebugging() {},
    logError() {},
    errorMessage: error =>
      error instanceof Error ? error.message : String(error),
  })
}

async function createFakeLspServer({ behavior = 'normal' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'deepcode-lsp-server-'))
  const logPath = join(dir, 'events.jsonl')
  const scriptPath = join(dir, 'fake-lsp-server.mjs')

  await writeFile(scriptPath, fakeServerSource())

  return {
    scriptPath,
    logPath,
    env() {
      return {
        DEEPCODE_FAKE_LSP_LOG: logPath,
        DEEPCODE_FAKE_LSP_BEHAVIOR: behavior,
      }
    },
    async events() {
      if (!existsSync(logPath)) return []
      return readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    },
    async methods() {
      await waitFor(async () => (await this.events()).length > 0)
      return (await this.events()).map(event => `${event.kind}:${event.method}`)
    },
    async waitForMethod(method) {
      await waitFor(async () => (await this.methods()).includes(method))
    },
  }
}

function fakeServerSource() {
  return String.raw`
import { appendFileSync } from 'node:fs'

const logPath = process.env.DEEPCODE_FAKE_LSP_LOG
const behavior = process.env.DEEPCODE_FAKE_LSP_BEHAVIOR || 'normal'
let buffer = Buffer.alloc(0)
let lastDocumentUri = 'file:///fake.ts'

function log(event) {
  appendFileSync(logPath, JSON.stringify(event) + '\n')
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n')
  process.stdout.write(body)
}

function sendDiagnostics() {
  const diagnostics = [
    {
      message: 'fake diagnostic',
      severity: 1,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 },
      },
      source: 'fake-lsp',
    },
  ]
  if (behavior === 'duplicate-diagnostics-on-save') {
    diagnostics.push({ ...diagnostics[0] })
  }
  writeMessage({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri: lastDocumentUri,
      diagnostics,
    },
  })
}

function handleMessage(message) {
  if (message.id !== undefined && message.method) {
    log({ kind: 'request', method: message.method })
    if (message.method === 'initialize') {
      if (behavior === 'crash-before-initialize') {
        process.exit(5)
      }
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            definitionProvider: true,
            textDocumentSync: 2,
          },
        },
      })
      if (behavior === 'diagnostics-after-init') {
        setTimeout(sendDiagnostics, 25)
      }
      if (behavior === 'crash-after-init') {
        setTimeout(() => process.exit(7), 50)
      }
      return
    }
    if (message.method === 'shutdown') {
      writeMessage({ jsonrpc: '2.0', id: message.id, result: null })
      return
    }
    writeMessage({ jsonrpc: '2.0', id: message.id, result: null })
    return
  }

  if (message.method) {
    log({ kind: 'notification', method: message.method })
    if (message.params && message.params.textDocument && message.params.textDocument.uri) {
      lastDocumentUri = message.params.textDocument.uri
    }
    if (
      message.method === 'textDocument/didSave' &&
      (behavior === 'diagnostics-on-save' || behavior === 'duplicate-diagnostics-on-save')
    ) {
      setTimeout(sendDiagnostics, 25)
    }
    if (message.method === 'exit') {
      setTimeout(() => process.exit(0), 10)
    }
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
    if (!lengthMatch) {
      process.exit(2)
    }
    const bodyLength = Number(lengthMatch[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + bodyLength
    if (buffer.length < bodyEnd) return
    const body = buffer.slice(bodyStart, bodyEnd).toString('utf8')
    buffer = buffer.slice(bodyEnd)
    handleMessage(JSON.parse(body))
  }
})

process.on('SIGTERM', () => {
  log({ kind: 'signal', method: 'SIGTERM' })
  process.exit(0)
})
`
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await delay(25)
  }
  assert.fail('Timed out waiting for condition')
}
