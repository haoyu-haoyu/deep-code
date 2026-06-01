// Real tool-executing ACP turn driver. Replaces the one-turn echo with the
// DeepSeek-native agent loop (runDeepSeekAgent): the model can call read-only
// tools to inspect the workspace and the loop feeds results back until it
// answers. Streams provider output as ACP session/update objects.
//
// PR1 ships READ-ONLY tools only (Read + the read-only Bash allowlist: ls/cat/
// pwd), sandboxed to the session cwd. Read-only tools need no approval, so this
// is safe to expose over stdio. Write/exec tools + the ACP
// session/request_permission round-trip are a follow-up.
//
// All-.mjs (DeepSeek-native stack) → works in raw src AND the standalone binary
// (no bundle-only .ts import, unlike the echo path's queryRuntimeWithStreaming).

import {
  mergeDeepSeekToolCallDelta,
  runDeepSeekAgent,
  streamDeepSeekQuery,
} from '../../../deepcode/deepseek-native.mjs'
import { createDeepSeekLocalTools } from '../../../deepcode/local-toolchain.mjs'

export const ACP_AGENT_SYSTEM_PROMPT = [
  'You are Deep Code, a DeepSeek-native coding assistant driving an editor over the Agent Client Protocol.',
  'Use the read-only tools (Read; Bash limited to ls/cat/pwd) to inspect the workspace before answering.',
  'Answer concisely and cite file paths (and line numbers where useful).',
]

const MAX_TOOL_RESULT_CHARS = 2000

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text
}

function safeParseArgs(raw) {
  if (!raw) return {}
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return { _raw: raw }
  }
}

/** Map a low-level DeepSeek provider delta to an ACP session/update, or null. */
export function mapProviderEventToAcp(event) {
  if (event?.type === 'reasoning_delta' && typeof event.text === 'string') {
    return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: event.text } }
  }
  if (event?.type === 'content_delta' && typeof event.text === 'string') {
    return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.text } }
  }
  return null
}

/**
 * The read-only ACP tool set: the local toolchain's tools MINUS Edit (the only
 * writer), each wrapped to emit ACP tool_call_update lifecycle events.
 */
export function buildReadOnlyAcpTools({ cwd = process.cwd(), onUpdate = () => {}, signal } = {}) {
  return createDeepSeekLocalTools({ cwd })
    .filter(tool => tool.name !== 'Edit')
    .map(tool => ({
      name: tool.name,
      description: tool.description,
      inputJSONSchema: tool.inputJSONSchema,
      async execute(input, ctx) {
        // Don't start a tool once the turn was cancelled (runDeepSeekAgent has no
        // signal of its own; in-flight model requests abort via complete()).
        if (signal?.aborted) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        }
        const toolCallId = ctx?.toolCall?.id ?? ''
        onUpdate({ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' })
        try {
          const result = await tool.execute(input, ctx)
          const text = typeof result === 'string' ? result : JSON.stringify(result)
          onUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: truncate(text, MAX_TOOL_RESULT_CHARS) } }],
          })
          return result
        } catch (error) {
          onUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: 'failed',
            content: [{ type: 'content', content: { type: 'text', text: String(error?.message ?? error) } }],
          })
          throw error
        }
      },
    }))
}

// A streaming complete(request) for runDeepSeekAgent: stream provider events,
// push ACP text/thought updates as they arrive, announce tool calls, and return
// the aggregate the agent loop expects. Records the turn's finishReason in
// `state` so the driver can map the final stop reason.
function makeStreamingComplete({ push, signal, state }) {
  return async function complete(request) {
    let content = ''
    let reasoning = ''
    let usage = null
    let finishReason
    const toolCalls = new Map()
    for await (const event of streamDeepSeekQuery({ ...request, signal })) {
      const update = mapProviderEventToAcp(event)
      if (update) {
        if (event.type === 'reasoning_delta') reasoning += event.text
        else content += event.text
        push(update)
      } else if (event.type === 'tool_call_delta') {
        mergeDeepSeekToolCallDelta(toolCalls, event)
        if (event.finishReason) finishReason = event.finishReason
      } else if (event.type === 'finish') {
        finishReason = event.finishReason
      } else if (event.type === 'usage') {
        usage = event.usage
      }
    }
    for (const call of toolCalls.values()) {
      push({
        sessionUpdate: 'tool_call',
        toolCallId: call.id,
        title: call.function?.name ?? 'tool',
        kind: 'other',
        status: 'pending',
        rawInput: safeParseArgs(call.function?.arguments),
      })
    }
    state.finishReason = finishReason
    return { content, reasoning, usage, finishReason, toolCalls: [...toolCalls.values()] }
  }
}

/**
 * Bridge a callback-pushing async task into an async generator: `drive(push)`
 * runs, pushing values that the generator yields in order; the generator
 * returns `drive`'s resolved value and rethrows its error. Pure + testable.
 */
export async function* pumpUpdates(drive) {
  const queue = []
  let notify = null
  let done = false
  let error = null
  let result
  const wake = () => {
    if (notify) {
      const n = notify
      notify = null
      n()
    }
  }
  const push = value => {
    queue.push(value)
    wake()
  }
  // Defer the call so a SYNCHRONOUS throw in `drive` becomes a rejection (caught
  // below) AFTER any already-queued items are drained — honoring the
  // drain-then-rethrow contract for all callers, not just async ones.
  Promise.resolve()
    .then(() => drive(push))
    .then(value => { result = value })
    .catch(err => { error = err })
    .finally(() => { done = true; wake() })

  while (true) {
    while (queue.length) yield queue.shift()
    if (done) break
    await new Promise(resolve => { notify = resolve })
  }
  if (error) throw error
  return result
}

/**
 * Real tool-executing ACP turn. Async generator yielding ACP session/update
 * objects; its return value is the runtime finish reason (mapped to an ACP
 * stopReason by the dispatcher). `runAgent` is injectable for tests.
 */
export function acpAgentTurn({
  prompt,
  signal,
  env = process.env,
  cwd = process.cwd(),
  runAgent = runDeepSeekAgent,
} = {}) {
  return pumpUpdates(async push => {
    const tools = buildReadOnlyAcpTools({ cwd, onUpdate: push, signal })
    const state = { finishReason: undefined }
    const complete = makeStreamingComplete({ push, signal, state })
    const result = await runAgent({
      prompt,
      systemPrompt: ACP_AGENT_SYSTEM_PROMPT,
      tools,
      env,
      cwd,
      maxTurns: 8,
      complete,
    })
    return result?.stoppedReason === 'max_turns' ? 'max_turns' : state.finishReason ?? 'end_turn'
  })
}
