// ACP stdio transport: wires the pure dispatcher (protocol.mjs) to stdin/stdout
// and provides the real DeepSeek-native turn driver. Kept thin — all the
// testable logic lives in protocol.mjs.

import { StringDecoder } from 'node:string_decoder'
import { createSessionRegistry } from '../sessions.mjs'
import {
  createAcpServer,
  encodeMessage,
  mapRuntimeEventToAcp,
  parseJsonRpcChunk,
} from './protocol.mjs'

/**
 * Default turn driver: one DeepSeek-native model turn via the runtime, mapping
 * raw RuntimeStreamEvents to ACP `session/update` objects. Streams text and
 * (when thinking is enabled via DEEPCODE_ACP_MAX_THINKING) reasoning. It does
 * NOT execute tools — tool_use blocks are surfaced as pending tool_call updates;
 * a tool-executing loop is a follow-up.
 */
export async function* defaultAcpRunTurn({ prompt, signal, env = process.env }) {
  const runtime = await import('../../../services/runtime/messageSend.js')
  const model = env.DEEPSEEK_MODEL ?? env.DEEPCODE_MODEL ?? 'deepseek-v4-pro'
  const maxThinkingTokens = Number(env.DEEPCODE_ACP_MAX_THINKING ?? 0) || 0
  const stream = runtime.queryRuntimeWithStreaming({
    systemPrompt: [],
    messages: [{ role: 'user', content: prompt }],
    maxThinkingTokens,
    tools: [],
    model,
    signal,
  })
  let stopReason
  for await (const event of stream) {
    if (event?.type === 'message_delta' && typeof event.stopReason === 'string') {
      stopReason = event.stopReason
    }
    const update = mapRuntimeEventToAcp(event)
    if (update) yield update
  }
  return stopReason
}

/**
 * Start an ACP server over the given streams. Returns `{ closed }` — a promise
 * that resolves when stdin ends — so the caller can keep the process alive for
 * the lifetime of the editor connection.
 */
export function startAcpServer({
  stdin = process.stdin,
  stdout = process.stdout,
  env = process.env,
  runTurn = defaultAcpRunTurn,
  sessions = createSessionRegistry(),
} = {}) {
  const send = message => stdout.write(encodeMessage(message))
  const server = createAcpServer({ runTurn, sessions, send, env })

  let leftover = ''
  // StringDecoder buffers an incomplete multibyte UTF-8 sequence split across
  // stdin chunks, so a code point straddling a chunk boundary isn't corrupted.
  const decoder = new StringDecoder('utf8')
  // In-flight handler promises (a streaming session/prompt), so a half-close
  // client that ends stdin mid-turn still gets its final response.
  const pending = new Set()
  let finished = false
  let resolveClosed
  const closed = new Promise(resolve => {
    resolveClosed = resolve
  })

  const onData = chunk => {
    const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk)
    const { messages, rest, malformed } = parseJsonRpcChunk(leftover + text)
    leftover = rest
    for (let i = 0; i < malformed.length; i++) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    for (const message of messages) {
      // Fire-and-forget: a long-running session/prompt must not block the read
      // loop (the client may send session/cancel while it streams). Track it so
      // shutdown can wait for its response.
      const task = Promise.resolve(server.handleMessage(message)).catch(() => {})
      pending.add(task)
      task.finally(() => pending.delete(task))
    }
  }

  const finish = async () => {
    if (finished) return
    finished = true
    stdin.off?.('data', onData)
    // Let in-flight handlers finish writing their responses before the
    // connection is considered closed — bounded, so a hung turn can't keep the
    // process alive forever after the editor disconnects.
    if (pending.size > 0) {
      let timer
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise(resolve => {
          timer = setTimeout(resolve, 30_000)
          timer.unref?.()
        }),
      ])
      clearTimeout(timer)
    }
    resolveClosed()
  }

  stdin.on('data', onData)
  stdin.once('end', finish)
  stdin.once('close', finish)
  stdin.once('error', finish)
  stdin.resume?.()

  return { closed, server, sessions }
}
