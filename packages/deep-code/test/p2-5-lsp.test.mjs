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

test('LSP instance rejects in-flight requests and marks error when the server exits cleanly unprompted', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-cleanexit-'))
  const server = await createFakeLspServer({ behavior: 'clean-exit-on-hover' })
  const instance = createTestServerInstance(
    'fake-ts',
    serverConfig(server, workspaceRoot),
  )

  // The fake server exits with code 0 (a CLEAN exit, not a crash) while the
  // hover request is in flight and unanswered. The request must reject — not
  // pend forever — and onCrash must still fire so the instance becomes
  // restartable.
  let timeoutId
  const stillPending = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('request still pending after server exit')),
      3_000,
    )
  })
  stillPending.catch(() => {})

  try {
    await instance.start()
    await assert.rejects(
      () =>
        Promise.race([
          instance.sendRequest('textDocument/hover', {
            position: { line: 0, character: 0 },
          }),
          stillPending,
        ]),
      /exited unexpectedly/i,
    )
    await waitFor(() => instance.state === 'error')
  } finally {
    clearTimeout(timeoutId)
    await instance.stop().catch(() => {})
  }
})

test('LSP client sendRequest enforces a per-request timeout when the server never answers', async () => {
  const server = await createFakeLspServer({ behavior: 'swallow-request' })
  const client = createTestClient('fake-ts')

  try {
    await client.start(process.execPath, [server.scriptPath], { env: server.env() })
    // initialize uses sendRawRequest WITHOUT a timeout and still completes — the
    // per-request deadline is post-initialize only (init has its own timeout).
    const init = await client.initialize({ processId: process.pid })
    assert.equal(init.capabilities.definitionProvider, true)

    // The server accepts the request but never replies. Without the timeout this
    // promise would pend forever and hang the agentic turn.
    const started = Date.now()
    await assert.rejects(
      () =>
        client.sendRequest(
          'textDocument/hover',
          { textDocument: { uri: 'file:///fake.ts' } },
          150,
        ),
      /timed out after 150ms/,
    )
    assert.ok(Date.now() - started < 3_000, 'rejected promptly, did not hang')
  } finally {
    await client.stop().catch(() => {})
  }
})

test('LSP instance bounds a stuck request via config.requestTimeout and stays running', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-timeout-'))
  const server = await createFakeLspServer({ behavior: 'swallow-request' })
  const instance = createTestServerInstance('fake-ts', {
    ...serverConfig(server, workspaceRoot),
    requestTimeout: 200,
  })

  try {
    await instance.start()
    const started = Date.now()
    await assert.rejects(
      () =>
        instance.sendRequest('textDocument/hover', {
          position: { line: 0, character: 0 },
        }),
      /timed out after 200ms/,
    )
    assert.ok(Date.now() - started < 3_000, 'rejected promptly')
    // A timeout is not a crash: the server is alive (just stuck), so the
    // instance stays usable rather than being torn down / marked error.
    assert.equal(instance.state, 'running')
  } finally {
    await instance.stop().catch(() => {})
  }
})

test('LSP manager re-sends didOpen to a restarted server instead of trusting stale openedFiles', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-reopen-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer({ behavior: 'crash-on-didsave' })
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    await manager.openFile(filePath, 'const value = 1\n')
    await server.waitForMethod('notification:textDocument/didOpen')

    const instance = manager.getAllServers().get('fake-ts')
    await manager.saveFile(filePath)
    await waitFor(() => instance.state === 'error')

    // openFile restarts the server; the fresh process has no open documents,
    // so the didOpen must be re-sent — a stale openedFiles entry would skip it
    // and leave the new server blind to the file.
    await manager.openFile(filePath, 'const value = 2\n')
    await waitFor(async () => {
      const methods = await server.methods()
      return (
        methods.filter(
          method => method === 'notification:textDocument/didOpen',
        ).length === 2
      )
    })
    assert.equal(manager.isFileOpen(filePath), true)
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('LSP manager reports a crashed server file as not open so callers re-send didOpen first', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-staleopen-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer({ behavior: 'crash-on-didsave' })
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    await manager.openFile(filePath, 'const value = 1\n')
    await server.waitForMethod('notification:textDocument/didOpen')
    assert.equal(manager.isFileOpen(filePath), true)

    const instance = manager.getAllServers().get('fake-ts')
    await manager.saveFile(filePath)
    await waitFor(() => instance.state === 'error')

    // LSPTool consults isFileOpen BEFORE sendRequest to decide whether to send
    // didOpen. A stale true here would skip the re-open and aim the first
    // post-restart request at a process that never saw the document.
    assert.equal(manager.isFileOpen(filePath), false)

    // changeFile must likewise fall back to a full re-open (didOpen #2), not
    // didChange a document the fresh process never saw.
    await manager.changeFile(filePath, 'const value = 2\n')
    await waitFor(async () => {
      const methods = await server.methods()
      return (
        methods.filter(
          method => method === 'notification:textDocument/didOpen',
        ).length === 2
      )
    })
    assert.equal(manager.isFileOpen(filePath), true)
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('LSP manager sendRequest refuses to blind-restart a crashed server (no didOpen-less first request)', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepcode-lsp-blindfire-'))
  const filePath = join(workspaceRoot, 'demo.ts')
  const server = await createFakeLspServer({ behavior: 'crash-on-didsave' })
  const manager = createTestManager({
    'fake-ts': serverConfig(server, workspaceRoot),
  })

  try {
    await manager.initialize()
    await manager.openFile(filePath, 'const value = 1\n')
    await server.waitForMethod('notification:textDocument/didOpen')

    const instance = manager.getAllServers().get('fake-ts')
    await manager.saveFile(filePath)
    await waitFor(() => instance.state === 'error')

    // The server died AFTER the file was opened (LSPTool's window between its
    // openFile and sendRequest). sendRequest must NOT silently restart the
    // server and fire at a process that never saw didOpen — it fails with the
    // health-check error and leaves the instance restartable.
    await assert.rejects(
      () =>
        manager.sendRequest(filePath, 'textDocument/hover', {
          textDocument: { uri: 'file://ignored' },
          position: { line: 0, character: 0 },
        }),
      /Cannot send request/i,
    )
    assert.equal(instance.state, 'error')
    const didOpenCount = (await server.methods()).filter(
      method => method === 'notification:textDocument/didOpen',
    ).length
    assert.equal(didOpenCount, 1)

    // The caller's retry path heals: isFileOpen is false, so it re-opens
    // (restarting the server) and only then requests.
    assert.equal(manager.isFileOpen(filePath), false)
    await manager.openFile(filePath, 'const value = 1\n')
    await waitFor(async () => {
      const methods = await server.methods()
      return (
        methods.filter(
          method => method === 'notification:textDocument/didOpen',
        ).length === 2
      )
    })
    const result = await manager.sendRequest(filePath, 'textDocument/hover', {
      position: { line: 0, character: 0 },
    })
    assert.equal(result, null)
  } finally {
    await manager.shutdown().catch(() => {})
  }
})

test('LSP client stop() settles instead of hanging when the server dies during shutdown', async () => {
  const server = await createFakeLspServer({ behavior: 'crash-on-shutdown' })
  let crashes = 0
  const client = createTestClient('fake-ts', () => {
    crashes += 1
  })

  // The fake server exits without answering the shutdown request. stop()
  // awaits that round-trip, so without the isStopping exit-path rejection it
  // would pend forever (and manager.shutdown() would hang the process).
  let timeoutId
  const stillHanging = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('stop() still pending after server died')),
      3_000,
    )
  })
  stillHanging.catch(() => {})

  try {
    await client.start(process.execPath, [server.scriptPath], {
      env: server.env(),
    })
    await client.initialize({ processId: process.pid })
    await assert.rejects(
      () => Promise.race([client.stop(), stillHanging]),
      /exited during shutdown/i,
    )
    // The exit was deliberate; it must not be reported as a crash.
    assert.equal(crashes, 0)
  } finally {
    clearTimeout(timeoutId)
    await client.stop().catch(() => {})
  }
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

test('LSP registry leaves unsupported languages unresolved', () => {
  const options = { isCommandAvailable: () => true }

  assert.equal(resolveLspServer('.rb', {}, options), undefined)
  assert.equal(resolveLspServer('.java', {}, options), undefined)
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

test('LSP registry resolves Rust, Go, Python, C, C++, and headers when binaries are available', () => {
  const cases = [
    ['.rs', 'rust-analyzer', [], 'rust'],
    ['.go', 'gopls', ['serve'], 'go'],
    ['.py', 'pyright-langserver', ['--stdio'], 'python'],
    ['.c', 'clangd', [], 'c'],
    ['.cpp', 'clangd', [], 'cpp'],
    ['.cc', 'clangd', [], 'cpp'],
    ['.cxx', 'clangd', [], 'cpp'],
    ['.hpp', 'clangd', [], 'cpp'],
    ['.h', 'clangd', [], 'c'],
  ]

  for (const [extension, command, args, languageId] of cases) {
    const config = resolveLspServer(extension, {}, {
      isCommandAvailable: () => true,
    })

    assert.equal(config.command, command)
    assert.deepEqual(config.args, args)
    assert.equal(config.extensionToLanguage[extension], languageId)
  }
})

test('LSP registry silently skips all new built-ins when binaries are missing', () => {
  for (const extension of [
    '.rs',
    '.go',
    '.py',
    '.c',
    '.cpp',
    '.cc',
    '.cxx',
    '.hpp',
    '.h',
  ]) {
    assert.equal(
      resolveLspServer(extension, {}, { isCommandAvailable: () => false }),
      undefined,
    )
  }
})

test('LSP registry lets plugin servers override new built-in languages', () => {
  const pluginServers = {
    'plugin:test:rust': {
      command: 'custom-rust-lsp',
      args: ['--stdio'],
      extensionToLanguage: {
        '.rs': 'rust',
      },
      scope: 'dynamic',
      source: 'test-plugin',
    },
  }

  const config = resolveLspServer('.rs', pluginServers, {
    isCommandAvailable: () => true,
  })

  assert.equal(config.command, 'custom-rust-lsp')
  assert.equal(config.source, 'test-plugin')
})

test('LSP registry groups built-in extensions by server command', () => {
  const merged = mergeBuiltInLspServers({}, {
    isCommandAvailable: () => true,
  })

  assert.equal(
    merged['builtin:typescript'].command,
    'typescript-language-server',
  )
  assert.deepEqual(merged['builtin:typescript'].extensionToLanguage, {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
  })
  assert.equal(merged['builtin:rust-analyzer'].command, 'rust-analyzer')
  assert.deepEqual(merged['builtin:rust-analyzer'].extensionToLanguage, {
    '.rs': 'rust',
  })
  assert.equal(merged['builtin:gopls'].command, 'gopls')
  assert.deepEqual(merged['builtin:gopls'].args, ['serve'])
  assert.equal(merged['builtin:pyright'].command, 'pyright-langserver')
  assert.deepEqual(merged['builtin:clangd'].extensionToLanguage, {
    '.c': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.h': 'c',
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

test('LSP client onNotification returns an unsubscribe that removes the handler', async () => {
  // diagnostics-on-save emits a fresh push for each didSave, so we can drive
  // a real second push and prove the unsubscribed handler is suppressed.
  const server = await createFakeLspServer({ behavior: 'diagnostics-on-save' })
  const client = createTestClient('fake-ts')
  let firstCalls = 0
  let secondCalls = 0
  const off = client.onNotification('textDocument/publishDiagnostics', () => {
    firstCalls += 1
  })

  try {
    await client.start(process.execPath, [server.scriptPath], {
      env: server.env(),
    })
    await client.initialize({ processId: process.pid })

    // First push reaches the handler.
    await client.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///fake.ts' },
    })
    await waitFor(() => firstCalls === 1)

    // Unsubscribe the first handler; register a second that stays live as a
    // deterministic witness that the next push actually arrived.
    off()
    client.onNotification('textDocument/publishDiagnostics', () => {
      secondCalls += 1
    })
    await client.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///fake.ts' },
    })
    await waitFor(() => secondCalls === 1)
    assert.equal(firstCalls, 1, 'unsubscribed handler must not fire again')
  } finally {
    await client.stop().catch(() => {})
  }
})

test('post-edit diagnostics removes its collector so handlers do not accumulate', async () => {
  // Inject a manager whose server records each onNotification registration
  // and whether its unsubscribe was called — a real publishDiagnostics handler
  // Set is closure-private, so we observe the contract directly.
  let live = 0
  const registrations = []
  const fakeServer = {
    onNotification(method, handler) {
      const reg = { method, handler, removed: false }
      registrations.push(reg)
      live += 1
      return () => {
        if (!reg.removed) {
          reg.removed = true
          live -= 1
        }
      }
    },
  }
  const fakeManager = {
    async ensureServerStarted() {
      return fakeServer
    },
    isFileOpen: () => false,
    async openFile() {},
    async changeFile() {},
    async saveFile() {},
  }

  const run = () =>
    notifyAndCollectDiagnosticsCore({
      filePath: '/tmp/leak-demo.ts',
      content: 'const value: string = 1\n',
      operation: 'edit',
      pollDelay: 1,
      maxDiagnostics: 10,
      lspManager: fakeManager,
      clearDeliveredDiagnosticsForFile() {},
      formatDiagnosticsForAttachment: () => [],
      delay,
      logForDebugging() {},
      logError() {},
    })

  // Several edits in a row: without the unsubscribe each leaves a collector
  // behind, so the handler count would climb with every call.
  await run()
  await run()
  await run()

  assert.equal(registrations.length, 3, 'each call registers one collector')
  assert.equal(live, 0, 'every collector must be removed after its call returns')
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
      if (behavior === 'crash-on-shutdown') {
        process.exit(9)
      }
      writeMessage({ jsonrpc: '2.0', id: message.id, result: null })
      return
    }
    if (
      behavior === 'clean-exit-on-hover' &&
      message.method === 'textDocument/hover'
    ) {
      process.exit(0)
    }
    if (behavior === 'swallow-request') {
      // Accept the request (already logged) but never answer it — a
      // healthy-but-stuck server that hangs the client absent a request timeout.
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
    if (
      message.method === 'textDocument/didSave' &&
      behavior === 'crash-on-didsave'
    ) {
      process.exit(7)
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
