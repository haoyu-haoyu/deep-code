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

test('LSP client performs initialize + initialized handshake', async () => {
  const server = await createFakeLspServer()
  const client = createTestClient('fake-ts')

  try {
    await client.start(process.execPath, [server.scriptPath], {
      env: server.env(),
    })
    const result = await client.initialize({ processId: process.pid })

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

function log(event) {
  appendFileSync(logPath, JSON.stringify(event) + '\n')
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n')
  process.stdout.write(body)
}

function sendDiagnostics() {
  writeMessage({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri: 'file:///fake.ts',
      diagnostics: [
        {
          message: 'fake diagnostic',
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 4 },
          },
          source: 'fake-lsp',
        },
      ],
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
    if (message.method === 'textDocument/didSave' && behavior === 'diagnostics-on-save') {
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
