import { spawn as nodeSpawn } from 'node:child_process'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const LSP_ERROR_CONTENT_MODIFIED = -32801
const MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3
const RETRY_BASE_DELAY_MS = 500
// Default per-request deadline for post-initialize requests. A stuck server that
// accepts the write but never replies would otherwise hang the agentic turn
// forever. Generous enough that a legitimately slow op (a cold-indexing gopls /
// rust-analyzer) is not falsely cut off; a config requestTimeout (incl. 0 to
// disable) overrides it. Initialize keeps its own startupTimeout instead.
const DEFAULT_LSP_REQUEST_TIMEOUT_MS = 30_000

export function createLSPClientCore({
  serverName,
  onCrash,
  spawn = nodeSpawn,
  subprocessEnv = () => process.env,
  logForDebugging = () => {},
  logError = () => {},
  errorMessage = defaultErrorMessage,
}) {
  let child
  let capabilities
  let isInitialized = false
  let startFailed = false
  let startError
  let isStopping = false
  let nextRequestId = 1
  let incoming = Buffer.alloc(0)
  const pendingRequests = new Map()
  const notificationHandlers = new Map()
  const requestHandlers = new Map()

  function checkStartFailed() {
    if (startFailed) {
      throw startError || new Error(`LSP server ${serverName} failed to start`)
    }
  }

  // Returns an unsubscribe so per-call listeners (e.g. the post-edit
  // diagnostics collector, registered on every Edit/Write) can be removed.
  // Without it the handler Set on this session-lifetime client grows
  // unboundedly and every diagnostics push fans out to every dead closure —
  // O(edits) memory and notification work over a long session.
  function onNotification(method, handler) {
    const handlers = notificationHandlers.get(method) || new Set()
    handlers.add(handler)
    notificationHandlers.set(method, handlers)
    return () => {
      handlers.delete(handler)
    }
  }

  function onRequest(method, handler) {
    requestHandlers.set(method, handler)
  }

  async function start(command, args = [], options = {}) {
    startFailed = false
    startError = undefined
    incoming = Buffer.alloc(0)

    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...subprocessEnv(), ...options.env },
        cwd: options.cwd,
        windowsHide: true,
      })

      if (!child.stdout || !child.stdin) {
        throw new Error('LSP server process stdio not available')
      }

      const spawnedChild = child
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          spawnedChild.removeListener('spawn', onSpawn)
          spawnedChild.removeListener('error', onError)
        }
        const onSpawn = () => {
          cleanup()
          resolve()
        }
        const onError = error => {
          cleanup()
          reject(error)
        }
        spawnedChild.once('spawn', onSpawn)
        spawnedChild.once('error', onError)
      })

      child.stdout.on('data', handleIncomingData)
      child.stderr?.on('data', data => {
        const output = data.toString().trim()
        if (output) {
          logForDebugging(`[LSP SERVER ${serverName}] ${output}`)
        }
      })
      child.stdin.on('error', error => {
        if (!isStopping) {
          logForDebugging(
            `LSP server ${serverName} stdin error: ${error.message}`,
          )
        }
      })
      child.on('error', error => {
        if (!isStopping) {
          startFailed = true
          startError = error
          logError(
            new Error(
              `LSP server ${serverName} failed to start: ${error.message}`,
            ),
          )
        }
      })
      child.on('exit', (code, signal) => {
        const exitedChild = child
        child = undefined
        isInitialized = false
        if (!isStopping) {
          // Any exit we did not initiate must settle in-flight requests and
          // report the crash — including a CLEAN self-exit (code 0). Without
          // the rejection those requests pend forever (nothing else resolves
          // them), and without onCrash the wrapping instance stays 'running'
          // so ensureServerStarted never restarts it.
          const crashError = new Error(
            code !== 0 && code !== null
              ? `LSP server ${serverName} crashed with exit code ${code}`
              : signal
                ? `LSP server ${serverName} exited with signal ${signal}`
                : `LSP server ${serverName} exited unexpectedly with code ${code}`,
          )
          rejectPendingRequests(crashError)
          logError(crashError)
          onCrash?.(crashError)
          return
        }
        // Deliberate stop: stop() awaits the shutdown round-trip, so if the
        // server dies BEFORE responding, that await would never settle and
        // stop() (and manager.shutdown()) would hang forever. Settle any
        // pending requests here; no onCrash — this exit was asked for.
        rejectPendingRequests(
          new Error(`LSP server ${serverName} exited during shutdown`),
        )
        if (!exitedChild) {
          logForDebugging(`LSP server ${serverName} connection closed`)
        }
      })

      logForDebugging(`LSP client started for ${serverName}`)
    } catch (error) {
      const err = toError(error)
      startFailed = true
      startError = err
      child = undefined
      logError(
        new Error(`LSP server ${serverName} failed to start: ${err.message}`),
      )
      throw err
    }
  }

  async function initialize(params) {
    if (!child) {
      throw new Error('LSP client not started')
    }
    checkStartFailed()

    try {
      const result = await sendRawRequest('initialize', params)
      capabilities = result.capabilities
      await sendRawNotification('initialized', {})
      isInitialized = true
      logForDebugging(`LSP server ${serverName} initialized`)
      return result
    } catch (error) {
      const err = toError(error)
      logError(
        new Error(`LSP server ${serverName} initialize failed: ${err.message}`),
      )
      throw err
    }
  }

  async function sendRequest(method, params, timeoutMs) {
    if (!child) {
      throw new Error('LSP client not started')
    }
    checkStartFailed()
    if (!isInitialized) {
      throw new Error('LSP server not initialized')
    }
    try {
      return await sendRawRequest(method, params, timeoutMs)
    } catch (error) {
      const err = toError(error)
      logError(
        new Error(
          `LSP server ${serverName} request ${method} failed: ${err.message}`,
        ),
      )
      throw err
    }
  }

  async function sendNotification(method, params) {
    if (!child) {
      throw new Error('LSP client not started')
    }
    checkStartFailed()
    try {
      await sendRawNotification(method, params)
    } catch (error) {
      const err = toError(error)
      logError(
        new Error(
          `LSP server ${serverName} notification ${method} failed: ${err.message}`,
        ),
      )
      logForDebugging(`Notification ${method} failed but continuing`)
    }
  }

  async function stop() {
    let shutdownError
    isStopping = true

    try {
      if (child && child.exitCode === null && !child.killed) {
        try {
          await sendRawRequest('shutdown', {})
          await sendRawNotification('exit', {})
          await delay(50)
        } catch (error) {
          shutdownError = toError(error)
          logError(
            new Error(
              `LSP server ${serverName} stop failed: ${shutdownError.message}`,
            ),
          )
        }
      }
    } finally {
      rejectPendingRequests(
        shutdownError || new Error(`LSP server ${serverName} stopped`),
      )
      cleanupChild()
      isInitialized = false
      capabilities = undefined
      isStopping = false
      if (shutdownError) {
        startFailed = true
        startError = shutdownError
      }
      logForDebugging(`LSP client stopped for ${serverName}`)
    }

    if (shutdownError) {
      throw shutdownError
    }
  }

  function sendRawRequest(method, params, timeoutMs) {
    const id = nextRequestId++
    const request = { jsonrpc: '2.0', id, method, params }
    const response = new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject })
    })

    const settled = writeMessage(request).then(() => response, error => {
      pendingRequests.delete(id)
      throw error
    })

    if (!(timeoutMs > 0)) return settled

    // Per-request deadline. A server that accepts the write but never answers (a
    // healthy-but-stuck server, or one that silently swallows a method it
    // advertised) would otherwise leave this request pending FOREVER and hang
    // the turn — the instance-level retry only fires on a rejection, never on a
    // silent hang. On fire, drop the pending entry (so a late reply is ignored
    // AND pendingRequests does not leak) and reject. A timeout is not a
    // ContentModified error, so the instance does not retry it — it surfaces.
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (pendingRequests.delete(id)) {
          reject(
            new Error(
              `LSP server ${serverName} request ${method} timed out after ${timeoutMs}ms`,
            ),
          )
        }
      }, timeoutMs)
    })
    return Promise.race([settled, timeout]).finally(() => clearTimeout(timer))
  }

  function sendRawNotification(method, params) {
    return writeMessage({ jsonrpc: '2.0', method, params })
  }

  function writeMessage(message) {
    if (!child?.stdin || child.stdin.destroyed) {
      return Promise.reject(new Error('LSP server stdin is not available'))
    }
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
    return new Promise((resolve, reject) => {
      child.stdin.write(Buffer.concat([header, body]), error => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  function handleIncomingData(chunk) {
    incoming = Buffer.concat([incoming, chunk])
    while (true) {
      const headerEnd = incoming.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = incoming.slice(0, headerEnd).toString('utf8')
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        const error = new Error(
          `LSP server ${serverName} sent a message without Content-Length`,
        )
        logError(error)
        cleanupChild()
        rejectPendingRequests(error)
        return
      }
      const bodyLength = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + bodyLength
      if (incoming.length < bodyEnd) return
      const body = incoming.slice(bodyStart, bodyEnd).toString('utf8')
      incoming = incoming.slice(bodyEnd)

      try {
        handleIncomingMessage(JSON.parse(body))
      } catch (error) {
        const err = toError(error)
        logError(err)
      }
    }
  }

  function handleIncomingMessage(message) {
    if (message.id !== undefined && message.method === undefined) {
      const pending = pendingRequests.get(message.id)
      if (!pending) return
      pendingRequests.delete(message.id)
      if (message.error) {
        const error = new Error(message.error.message || 'LSP request failed')
        if (typeof message.error.code === 'number') {
          error.code = message.error.code
        }
        pending.reject(error)
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method && message.id !== undefined) {
      handleServerRequest(message).catch(error => logError(toError(error)))
      return
    }

    if (message.method) {
      const handlers = notificationHandlers.get(message.method)
      if (!handlers) return
      for (const handler of handlers) {
        try {
          handler(message.params)
        } catch (error) {
          logError(toError(error))
        }
      }
    }
  }

  async function handleServerRequest(message) {
    const handler = requestHandlers.get(message.method)
    if (!handler) {
      await writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: null,
      })
      return
    }

    try {
      const result = await handler(message.params)
      await writeMessage({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      await writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: errorMessage(error),
        },
      })
    }
  }

  function rejectPendingRequests(error) {
    for (const pending of pendingRequests.values()) {
      pending.reject(error)
    }
    pendingRequests.clear()
  }

  function cleanupChild() {
    if (!child) return
    child.stdout?.removeAllListeners('data')
    child.stderr?.removeAllListeners('data')
    child.stdin?.removeAllListeners('error')
    child.removeAllListeners('error')
    child.removeAllListeners('exit')
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill()
      } catch (error) {
        logForDebugging(
          `Process kill failed for ${serverName} (may already be dead): ${errorMessage(error)}`,
        )
      }
    }
    child = undefined
  }

  return {
    get capabilities() {
      return capabilities
    },
    get isInitialized() {
      return isInitialized
    },
    start,
    initialize,
    sendRequest,
    sendNotification,
    onNotification,
    onRequest,
    stop,
  }
}

export function createLSPServerInstanceCore({
  name,
  config,
  createLSPClient,
  getCwd = () => process.cwd(),
  sleep = delay,
  logForDebugging = () => {},
  logError = () => {},
  errorMessage = defaultErrorMessage,
}) {
  if (config.restartOnCrash !== undefined) {
    throw new Error(
      `LSP server '${name}': restartOnCrash is not yet implemented. Remove this field from the configuration.`,
    )
  }
  if (config.shutdownTimeout !== undefined) {
    throw new Error(
      `LSP server '${name}': shutdownTimeout is not yet implemented. Remove this field from the configuration.`,
    )
  }

  let state = 'stopped'
  let startTime
  let lastError
  let restartCount = 0
  let crashRecoveryCount = 0
  const client = createLSPClient(name, error => {
    state = 'error'
    lastError = error
    crashRecoveryCount++
  })

  async function start() {
    if (state === 'running' || state === 'starting') return

    const maxRestarts = config.maxRestarts ?? 3
    if (state === 'error' && crashRecoveryCount > maxRestarts) {
      const error = new Error(
        `LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`,
      )
      lastError = error
      logError(error)
      throw error
    }

    let initPromise
    try {
      state = 'starting'
      logForDebugging(`Starting LSP server instance: ${name}`)

      await client.start(config.command, config.args || [], {
        env: config.env,
        cwd: config.workspaceFolder,
      })

      const workspaceFolder = config.workspaceFolder || getCwd()
      const workspaceUri = pathToFileURL(workspaceFolder).href
      const initParams = {
        processId: process.pid,
        initializationOptions: config.initializationOptions ?? {},
        workspaceFolders: [
          {
            uri: workspaceUri,
            name: path.basename(workspaceFolder),
          },
        ],
        rootPath: workspaceFolder,
        rootUri: workspaceUri,
        capabilities: {
          workspace: {
            configuration: false,
            workspaceFolders: false,
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: { valueSet: [1, 2] },
              versionSupport: false,
              codeDescriptionSupport: true,
              dataSupport: false,
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            references: { dynamicRegistration: false },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            callHierarchy: { dynamicRegistration: false },
          },
          general: { positionEncodings: ['utf-16'] },
        },
      }

      initPromise = client.initialize(initParams)
      if (config.startupTimeout !== undefined) {
        await withTimeout(
          initPromise,
          config.startupTimeout,
          `LSP server '${name}' timed out after ${config.startupTimeout}ms during initialization`,
        )
      } else {
        await initPromise
      }

      state = 'running'
      startTime = new Date()
      crashRecoveryCount = 0
      logForDebugging(`LSP server instance started: ${name}`)
    } catch (error) {
      client.stop().catch(() => {})
      initPromise?.catch(() => {})
      state = 'error'
      lastError = toError(error)
      logError(lastError)
      throw lastError
    }
  }

  async function stop() {
    if (state === 'stopped' || state === 'stopping') return
    try {
      state = 'stopping'
      await client.stop()
      state = 'stopped'
      logForDebugging(`LSP server instance stopped: ${name}`)
    } catch (error) {
      state = 'error'
      lastError = toError(error)
      logError(lastError)
      throw lastError
    }
  }

  async function restart() {
    try {
      await stop()
    } catch (error) {
      const stopError = new Error(
        `Failed to stop LSP server '${name}' during restart: ${errorMessage(error)}`,
      )
      logError(stopError)
      throw stopError
    }

    restartCount++
    const maxRestarts = config.maxRestarts ?? 3
    if (restartCount > maxRestarts) {
      const error = new Error(
        `Max restart attempts (${maxRestarts}) exceeded for server '${name}'`,
      )
      logError(error)
      throw error
    }

    try {
      await start()
    } catch (error) {
      const startError = new Error(
        `Failed to start LSP server '${name}' during restart (attempt ${restartCount}/${maxRestarts}): ${errorMessage(error)}`,
      )
      logError(startError)
      throw startError
    }
  }

  function isHealthy() {
    return state === 'running' && client.isInitialized
  }

  async function sendRequest(method, params) {
    if (!isHealthy()) {
      const error = new Error(
        `Cannot send request to LSP server '${name}': server is ${state}` +
          `${lastError ? `, last error: ${lastError.message}` : ''}`,
      )
      logError(error)
      throw error
    }

    // Unset → built-in default; 0 disables (a server that legitimately needs
    // unbounded time can opt out). Bounds a stuck server so the turn can't hang.
    const requestTimeout =
      config.requestTimeout ?? DEFAULT_LSP_REQUEST_TIMEOUT_MS

    let lastAttemptError
    for (
      let attempt = 0;
      attempt <= MAX_RETRIES_FOR_TRANSIENT_ERRORS;
      attempt++
    ) {
      try {
        return await client.sendRequest(method, params, requestTimeout)
      } catch (error) {
        lastAttemptError = toError(error)
        const errorCode = error && typeof error === 'object' ? error.code : undefined
        if (
          typeof errorCode === 'number' &&
          errorCode === LSP_ERROR_CONTENT_MODIFIED &&
          attempt < MAX_RETRIES_FOR_TRANSIENT_ERRORS
        ) {
          const waitMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          logForDebugging(
            `LSP request '${method}' to '${name}' got ContentModified error, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES_FOR_TRANSIENT_ERRORS})...`,
          )
          await sleep(waitMs)
          continue
        }
        break
      }
    }

    const requestError = new Error(
      `LSP request '${method}' failed for server '${name}': ${lastAttemptError?.message ?? 'unknown error'}`,
    )
    logError(requestError)
    throw requestError
  }

  async function sendNotification(method, params) {
    if (!isHealthy()) {
      const error = new Error(
        `Cannot send notification to LSP server '${name}': server is ${state}`,
      )
      logError(error)
      throw error
    }
    try {
      await client.sendNotification(method, params)
    } catch (error) {
      const notificationError = new Error(
        `LSP notification '${method}' failed for server '${name}': ${errorMessage(error)}`,
      )
      logError(notificationError)
      throw notificationError
    }
  }

  return {
    name,
    config,
    get state() {
      return state
    },
    get startTime() {
      return startTime
    },
    get lastError() {
      return lastError
    },
    get restartCount() {
      return restartCount
    },
    start,
    stop,
    restart,
    isHealthy,
    sendRequest,
    sendNotification,
    onNotification: (method, handler) => client.onNotification(method, handler),
    onRequest: (method, handler) => client.onRequest(method, handler),
  }
}

export function createLSPServerManagerCore({
  serverConfigs,
  loadServerConfigs,
  createServerInstance,
  logForDebugging = () => {},
  logError = () => {},
  errorMessage = defaultErrorMessage,
}) {
  const servers = new Map()
  const extensionMap = new Map()
  const openedFiles = new Map()

  async function initialize() {
    let configs
    try {
      configs = serverConfigs ?? (await loadServerConfigs()).servers
      logForDebugging(
        `[LSP SERVER MANAGER] loaded ${Object.keys(configs).length} server(s)`,
      )
    } catch (error) {
      const err = toError(error)
      logError(
        new Error(`Failed to load LSP server configuration: ${err.message}`),
      )
      throw err
    }

    servers.clear()
    extensionMap.clear()
    openedFiles.clear()

    for (const [serverName, config] of Object.entries(configs)) {
      try {
        validateServerConfig(serverName, config)
        for (const ext of Object.keys(config.extensionToLanguage)) {
          const normalized = ext.toLowerCase()
          const serverList = extensionMap.get(normalized) || []
          serverList.push(serverName)
          extensionMap.set(normalized, serverList)
        }

        const instance = createServerInstance(serverName, config)
        servers.set(serverName, instance)
        instance.onRequest('workspace/configuration', params =>
          params.items.map(() => null),
        )
      } catch (error) {
        const err = toError(error)
        logError(
          new Error(
            `Failed to initialize LSP server ${serverName}: ${err.message}`,
          ),
        )
      }
    }

    logForDebugging(`LSP manager initialized with ${servers.size} servers`)
  }

  async function shutdown() {
    const toStop = Array.from(servers.entries()).filter(
      ([, server]) => server.state === 'running' || server.state === 'error',
    )
    const results = await Promise.allSettled(
      toStop.map(([, server]) => server.stop()),
    )

    servers.clear()
    extensionMap.clear()
    openedFiles.clear()

    const errors = results
      .map((result, index) =>
        result.status === 'rejected'
          ? `${toStop[index][0]}: ${errorMessage(result.reason)}`
          : null,
      )
      .filter(Boolean)
    if (errors.length > 0) {
      const error = new Error(
        `Failed to stop ${errors.length} LSP server(s): ${errors.join('; ')}`,
      )
      logError(error)
      throw error
    }
  }

  function getServerForFile(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const serverNames = extensionMap.get(ext)
    if (!serverNames || serverNames.length === 0) return undefined
    return servers.get(serverNames[0])
  }

  async function ensureServerStarted(filePath) {
    const server = getServerForFile(filePath)
    if (!server) return undefined
    if (server.state === 'stopped' || server.state === 'error') {
      try {
        await server.start()
      } catch (error) {
        const err = toError(error)
        logError(
          new Error(
            `Failed to start LSP server for file ${filePath}: ${err.message}`,
          ),
        )
        throw err
      }
      // The freshly started process has no open documents. Entries recorded
      // against the previous process are already invalid (their startedAt no
      // longer matches — see isOpenInCurrentServerProcess); dropping them here
      // just keeps the map from accumulating dead generations.
      for (const [fileUri, entry] of openedFiles) {
        if (entry.serverName === server.name) {
          openedFiles.delete(fileUri)
        }
      }
    }
    return server
  }

  async function sendRequest(filePath, method, params) {
    // Deliberately NOT ensureServerStarted: a server (re)started at this point
    // has no document state — the fresh process never saw didOpen — so lazily
    // booting it here would silently aim a document-scoped request at a blind
    // server (callers open the file first, which is what starts the server).
    // If the server died since the open, fail with the instance's clear
    // health-check error; the caller's next attempt sees isFileOpen === false
    // and re-opens, which restarts the server properly.
    const server = getServerForFile(filePath)
    if (!server) return undefined
    try {
      return await server.sendRequest(method, params)
    } catch (error) {
      const err = toError(error)
      logError(
        new Error(
          `LSP request failed for file ${filePath}, method '${method}': ${err.message}`,
        ),
      )
      throw err
    }
  }

  // An openedFiles entry means "this document was opened in the server process
  // identified by startedAt" — server.startTime is a fresh Date OBJECT per
  // successful start, so identity-comparing it pins the entry to one process
  // generation. After a crash (state leaves 'running') or a restart (new
  // startTime), the entry no longer qualifies and every consumer — openFile's
  // skip, changeFile's didChange gate, isFileOpen — falls back to re-opening.
  // This is what callers like LSPTool rely on when they consult isFileOpen
  // BEFORE sendRequest: a stale "open" would make them skip didOpen and aim the
  // first post-restart request at a process that never saw the document.
  function isOpenInCurrentServerProcess(fileUri, server) {
    const entry = openedFiles.get(fileUri)
    return (
      entry !== undefined &&
      entry.serverName === server.name &&
      server.state === 'running' &&
      entry.startedAt === server.startTime
    )
  }

  async function openFile(filePath, content) {
    const server = await ensureServerStarted(filePath)
    if (!server) return

    const fileUri = pathToFileURL(path.resolve(filePath)).href
    if (isOpenInCurrentServerProcess(fileUri, server)) {
      logForDebugging(`LSP: File already open, skipping didOpen for ${filePath}`)
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const languageId = server.config.extensionToLanguage[ext] || 'plaintext'
    try {
      await server.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: fileUri,
          languageId,
          version: 1,
          text: content,
        },
      })
      openedFiles.set(fileUri, {
        serverName: server.name,
        startedAt: server.startTime,
      })
      logForDebugging(
        `LSP: Sent didOpen for ${filePath} (languageId: ${languageId})`,
      )
    } catch (error) {
      const err = new Error(
        `Failed to sync file open ${filePath}: ${errorMessage(error)}`,
      )
      logError(err)
      throw err
    }
  }

  async function changeFile(filePath, content) {
    const server = getServerForFile(filePath)
    if (!server || server.state !== 'running') {
      return openFile(filePath, content)
    }

    const fileUri = pathToFileURL(path.resolve(filePath)).href
    if (!isOpenInCurrentServerProcess(fileUri, server)) {
      return openFile(filePath, content)
    }

    try {
      await server.sendNotification('textDocument/didChange', {
        textDocument: {
          uri: fileUri,
          version: 1,
        },
        contentChanges: [{ text: content }],
      })
      logForDebugging(`LSP: Sent didChange for ${filePath}`)
    } catch (error) {
      const err = new Error(
        `Failed to sync file change ${filePath}: ${errorMessage(error)}`,
      )
      logError(err)
      throw err
    }
  }

  async function saveFile(filePath) {
    const server = getServerForFile(filePath)
    if (!server || server.state !== 'running') return
    try {
      await server.sendNotification('textDocument/didSave', {
        textDocument: {
          uri: pathToFileURL(path.resolve(filePath)).href,
        },
      })
      logForDebugging(`LSP: Sent didSave for ${filePath}`)
    } catch (error) {
      const err = new Error(
        `Failed to sync file save ${filePath}: ${errorMessage(error)}`,
      )
      logError(err)
      throw err
    }
  }

  async function closeFile(filePath) {
    const server = getServerForFile(filePath)
    if (!server || server.state !== 'running') return
    const fileUri = pathToFileURL(path.resolve(filePath)).href
    try {
      await server.sendNotification('textDocument/didClose', {
        textDocument: { uri: fileUri },
      })
      openedFiles.delete(fileUri)
      logForDebugging(`LSP: Sent didClose for ${filePath}`)
    } catch (error) {
      const err = new Error(
        `Failed to sync file close ${filePath}: ${errorMessage(error)}`,
      )
      logError(err)
      throw err
    }
  }

  function isFileOpen(filePath) {
    const server = getServerForFile(filePath)
    if (!server) return false
    return isOpenInCurrentServerProcess(
      pathToFileURL(path.resolve(filePath)).href,
      server,
    )
  }

  return {
    initialize,
    shutdown,
    getServerForFile,
    ensureServerStarted,
    sendRequest,
    getAllServers: () => servers,
    openFile,
    changeFile,
    saveFile,
    closeFile,
    isFileOpen,
  }
}

function validateServerConfig(serverName, config) {
  if (!config.command) {
    throw new Error(`Server ${serverName} missing required 'command' field`)
  }
  if (
    !config.extensionToLanguage ||
    Object.keys(config.extensionToLanguage).length === 0
  ) {
    throw new Error(
      `Server ${serverName} missing required 'extensionToLanguage' field`,
    )
  }
}

function withTimeout(promise, ms, message) {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timer),
  )
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

function defaultErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
