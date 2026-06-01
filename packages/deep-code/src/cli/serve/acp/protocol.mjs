// ACP (Agent Client Protocol — the Zed editor <-> agent protocol) core.
//
// ACP is newline-delimited JSON-RPC 2.0 over stdio (one compact JSON object per
// line, NOT LSP-style Content-Length framing). `vscode-jsonrpc` is stubbed to a
// no-op in the standalone binary, so this is a tiny dependency-free framer +
// dispatcher. Everything here is PURE (no process/stdio/network): the dispatcher
// takes an injected `runTurn` generator, a session registry, and a `send` sink,
// so it is fully unit-testable. The transport wiring lives in ./index.mjs.

export const ACP_PROTOCOL_VERSION = 1

// --- JSON-RPC newline framing --------------------------------------------

/** Encode a JSON-RPC message as one newline-terminated line. */
export function encodeMessage(message) {
  return JSON.stringify(message) + '\n'
}

/**
 * Split accumulated stdin text into complete JSON-RPC messages, returning any
 * trailing partial line as `rest` to prepend to the next chunk. Malformed lines
 * are skipped (a hostile/garbled line must not wedge the stream).
 *
 * @param {string} text
 * @returns {{ messages: any[], rest: string }}
 */
export function parseJsonRpcChunk(text) {
  const parts = String(text).split('\n')
  const rest = parts.pop() ?? ''
  const messages = []
  const malformed = []
  for (const line of parts) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      messages.push(JSON.parse(trimmed))
    } catch {
      // A complete-but-unparseable line: the transport answers it with a
      // JSON-RPC parse error (rather than wedging the connection silently).
      malformed.push(trimmed)
    }
  }
  return { messages, rest, malformed }
}

// --- ACP method helpers (pure) -------------------------------------------

/** Negotiate the protocol version: the lesser of the client's and ours. */
export function negotiateProtocolVersion(clientVersion) {
  const v = Number(clientVersion)
  if (!Number.isInteger(v) || v < 0) return ACP_PROTOCOL_VERSION
  return Math.min(v, ACP_PROTOCOL_VERSION)
}

/** The `initialize` result: capabilities for a text-streaming, read-only agent. */
export function buildInitializeResult(params = {}) {
  return {
    protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    },
    authMethods: [],
  }
}

/**
 * Flatten an ACP prompt (array of ContentBlocks, or a string) to plain text.
 * Keeps text blocks and renders baseline `resource_link` blocks as a reference
 * (so editor @-mentions aren't silently dropped); embedded `resource` blocks
 * contribute their text when present (we advertise embeddedContext:false, so
 * those are not expected, but handle them defensively).
 */
export function extractPromptText(prompt) {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return ''
  const parts = []
  for (const block of prompt) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'resource_link' && typeof block.uri === 'string') {
      parts.push(`@${block.name ?? block.uri} (${block.uri})`)
    } else if (block.type === 'resource' && typeof block.resource?.text === 'string') {
      parts.push(block.resource.text)
    }
  }
  return parts.join('')
}

/**
 * Map a runtime/provider stop reason to the ACP stopReason enum. Unknown or
 * tool-related reasons fall back to `end_turn` (this adapter does not execute
 * tools, so a tool stop simply ends the turn).
 */
export function mapStopReason(runtimeStopReason) {
  const reason = String(runtimeStopReason ?? '').toLowerCase()
  if (reason === 'length' || reason === 'max_tokens') return 'max_tokens'
  if (reason === 'max_turns' || reason === 'max_turn_requests') return 'max_turn_requests'
  if (reason === 'content_filter' || reason === 'refusal') return 'refusal'
  return 'end_turn'
}

/**
 * Map ONE runtime stream event (RuntimeStreamEvent from messageSend) to an ACP
 * `session/update` `update` object, or null to ignore. DeepSeek reasoning maps
 * to `agent_thought_chunk` (the native fit); answer text to
 * `agent_message_chunk`; a tool_use block to a pending `tool_call`.
 */
export function mapRuntimeEventToAcp(event) {
  if (!event || typeof event !== 'object') return null

  if (event.type === 'content_block_delta') {
    const delta = event.delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: delta.text } }
    }
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: delta.thinking } }
    }
    return null
  }

  if (event.type === 'content_block_start' && event.contentBlock?.type === 'tool_use') {
    const block = event.contentBlock
    return {
      sessionUpdate: 'tool_call',
      toolCallId: String(block.id ?? ''),
      title: String(block.name ?? 'tool'),
      kind: 'other',
      status: 'pending',
      rawInput: block.input ?? {},
    }
  }

  return null
}

function isAbortError(error) {
  const name = error?.name
  return name === 'AbortError' || name === 'RuntimeAbortError' || error?.aborted === true
}

// --- Dispatcher ----------------------------------------------------------

/**
 * Create an ACP method dispatcher. Pure given its injected collaborators:
 * - runTurn({prompt, signal, env}): async generator yielding ACP `update` objects
 * - sessions: a createSessionRegistry()-shaped object
 * - send(message): writes one JSON-RPC message (object) to the client
 *
 * @returns {{ handleMessage(message: any): Promise<void> }}
 */
export function createAcpServer({ runTurn, sessions, send, env = process.env } = {}) {
  if (typeof runTurn !== 'function') throw new TypeError('createAcpServer requires a runTurn function')
  if (!sessions || typeof sessions.startTurn !== 'function') throw new TypeError('createAcpServer requires a session registry')
  if (typeof send !== 'function') throw new TypeError('createAcpServer requires a send function')

  const hasId = id => id !== undefined && id !== null
  const reply = (id, result) => { if (hasId(id)) send({ jsonrpc: '2.0', id, result }) }
  const replyError = (id, code, message) => { if (hasId(id)) send({ jsonrpc: '2.0', id, error: { code, message } }) }
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params })

  async function handlePrompt(id, params) {
    const sessionId = params?.sessionId
    const promptText = extractPromptText(params?.prompt)
    const abortController = new AbortController()
    const started = sessions.startTurn(sessionId, { abortController })
    if (started.status === 'not_found') return replyError(id, -32602, `Unknown session: ${sessionId}`)
    if (started.status === 'conflict') return replyError(id, -32603, 'A turn is already active for this session')

    const turnId = started.turn.id
    let stopReason = 'end_turn'
    try {
      // Drive the iterator manually so its RETURN value (the runtime stop
      // reason) is captured — a plain for-await would discard it. The turn runs
      // in the session's cwd (from session/new).
      const iterator = runTurn({
        prompt: promptText,
        signal: abortController.signal,
        env,
        cwd: started.session?.cwd,
      })
      let step = await iterator.next()
      while (!step.done) {
        if (step.value) notify('session/update', { sessionId, update: step.value })
        step = await iterator.next()
      }
      stopReason = mapStopReason(step.value)
      sessions.completeTurn(sessionId, turnId, { status: 'completed' })
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        stopReason = 'cancelled'
        sessions.completeTurn(sessionId, turnId, { status: 'aborted' })
      } else {
        sessions.completeTurn(sessionId, turnId, { status: 'failed', error: String(error?.message ?? error) })
        return replyError(id, -32603, `Prompt turn failed: ${error?.message ?? error}`)
      }
    }
    reply(id, { stopReason })
  }

  async function handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return
    const { id, method, params } = message
    try {
      switch (method) {
        case 'initialize':
          reply(id, buildInitializeResult(params))
          break
        case 'authenticate':
          // No editor-side auth: the DeepSeek key comes from the environment.
          reply(id, {})
          break
        case 'session/new': {
          const session = sessions.createSession({ cwd: params?.cwd })
          reply(id, { sessionId: session.id })
          break
        }
        case 'session/prompt':
          await handlePrompt(id, params)
          break
        case 'session/cancel':
          // Notification: abort the in-flight turn; the pending prompt resolves
          // with stopReason 'cancelled'.
          sessions.abortActiveTurn(params?.sessionId)
          break
        default:
          replyError(id, -32601, `Method not found: ${method}`)
      }
    } catch (error) {
      replyError(id, -32603, `Internal error: ${error?.message ?? error}`)
    }
  }

  return { handleMessage }
}
