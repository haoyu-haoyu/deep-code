// Real tool-executing ACP turn driver. Replaces the one-turn echo with the
// DeepSeek-native agent loop (runDeepSeekAgent): the model can call read-only
// tools to inspect the workspace and the loop feeds results back until it
// answers. Streams provider output as ACP session/update objects.
//
// Read-only tools (Read + the read-only Bash allowlist: ls/cat/pwd) need no
// approval. Write tools (Edit/Write) are gated behind the ACP
// session/request_permission round-trip; the editor may answer `allow_always`,
// which the dispatcher remembers for the rest of the session so the same tool
// is not re-prompted. Everything is sandboxed to the session cwd.
//
// All-.mjs (DeepSeek-native stack) → works in raw src AND the standalone binary
// (no bundle-only .ts import, unlike the echo path's queryRuntimeWithStreaming).

import {
  mergeDeepSeekToolCallDelta,
  runDeepSeekAgent,
} from '../../../deepcode/deepseek-native.mjs'
import { createDeepSeekLocalTools } from '../../../deepcode/local-toolchain.mjs'
import { providerSupports } from '../../../deepcode/provider-capabilities.mjs'
import { resolveRuntimeModelProvider } from '../../../services/providers/runtime-provider.mjs'

export const ACP_AGENT_SYSTEM_PROMPT = [
  'You are Deep Code, a DeepSeek-native coding assistant driving an editor over the Agent Client Protocol.',
  'Inspect the workspace with Read and Bash (ls/cat/pwd) before acting.',
  'Use Edit to change an existing file and Write to create a new one. Writes require the user to approve them in the editor, so keep them minimal and precise; if a write is denied, stop and explain.',
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

/**
 * Map a low-level DeepSeek provider delta to an ACP session/update, or null.
 * `provider` (when given) gates reasoning: mirror the main query loop
 * (deepseek-call-model.mjs) and only surface reasoning as an ACP thought when the
 * provider supports reasoning_content. An openai-compatible provider declares it
 * false but reuses the DeepSeek SSE parser, which emits reasoning_delta for any
 * server that sends reasoning_content (e.g. a distill/reasoning model proxied via
 * vLLM/Ollama). Without this gate the ACP surface would leak chain-of-thought as
 * 'thoughts' for a provider the rest of the codebase treats as reasoning-incapable.
 */
export function mapProviderEventToAcp(event, provider) {
  if (event?.type === 'reasoning_delta' && typeof event.text === 'string') {
    if (provider && !providerSupports(provider, 'reasoning_content')) return null
    return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: event.text } }
  }
  if (event?.type === 'content_delta' && typeof event.text === 'string') {
    return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.text } }
  }
  return null
}

// Tools that mutate the workspace and therefore require editor approval before
// running. (The local toolchain's Bash is allowlisted to ls/cat/pwd — read-only
// — so it is NOT gated.)
const WRITE_TOOLS = new Set(['Edit', 'Write'])

function toolKind(name) {
  return name === 'Bash' ? 'execute' : 'edit'
}

// Wrap a bare-closure tool to emit ACP tool_call_update lifecycle events and,
// when it mutates the workspace, gate execution behind requestPermission.
function wrapTool(tool, { onUpdate, signal, requestPermission, needsApproval }) {
  return {
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
      if (needsApproval) {
        const approved =
          typeof requestPermission === 'function'
            ? await requestPermission({ toolCallId, title: tool.name, kind: toolKind(tool.name), rawInput: input })
            : false
        if (!approved) {
          onUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: 'failed',
            content: [{ type: 'content', content: { type: 'text', text: 'Permission denied by the editor.' } }],
          })
          throw new Error(`Permission denied for ${tool.name}`)
        }
      }
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
  }
}

/**
 * Read-only ACP tool set: the local toolchain MINUS every writer (Edit/Write),
 * each wrapped for tool_call_update events. No approval needed.
 */
export function buildReadOnlyAcpTools({ cwd = process.cwd(), onUpdate = () => {}, signal } = {}) {
  return createDeepSeekLocalTools({ cwd })
    .filter(tool => !WRITE_TOOLS.has(tool.name))
    .map(tool => wrapTool(tool, { onUpdate, signal, needsApproval: false }))
}

/**
 * Full ACP tool set: read-only tools run freely; write tools (Edit) are gated
 * behind the ACP session/request_permission round-trip via requestPermission
 * (which is deny-safe when there is no approver / on timeout / on disconnect).
 */
export function buildAcpTools({ cwd = process.cwd(), onUpdate = () => {}, signal, requestPermission } = {}) {
  return createDeepSeekLocalTools({ cwd }).map(tool =>
    wrapTool(tool, { onUpdate, signal, requestPermission, needsApproval: WRITE_TOOLS.has(tool.name) }),
  )
}

// A streaming complete(request) for runDeepSeekAgent: stream provider events,
// push ACP text/thought updates as they arrive, announce tool calls, and return
// the aggregate the agent loop expects. Records the turn's finishReason in
// `state` so the driver can map the final stop reason.
function makeStreamingComplete({ push, signal, state, provider }) {
  return async function complete(request) {
    let content = ''
    let reasoning = ''
    let usage = null
    let finishReason
    const toolCalls = new Map()
    // Stream via the configured provider (request is already built by its
    // buildRequest in runDeepSeekAgent). The event vocabulary is shared, so the
    // ACP mapping + tool-call merge below work for any provider.
    for await (const event of provider.streamQuery({ ...request, signal })) {
      const update = mapProviderEventToAcp(event, provider)
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
  requestPermission,
  runAgent = runDeepSeekAgent,
  // The configured runtime provider; defaults to DEEPCODE_PROVIDER resolution
  // (DeepSeek with nothing configured — byte-identical to the prior path).
  provider,
} = {}) {
  return pumpUpdates(async push => {
    const modelProvider = provider ?? resolveRuntimeModelProvider({ env })
    const tools = buildAcpTools({ cwd, onUpdate: push, signal, requestPermission })
    const state = { finishReason: undefined }
    const complete = makeStreamingComplete({ push, signal, state, provider: modelProvider })
    const result = await runAgent({
      prompt,
      systemPrompt: ACP_AGENT_SYSTEM_PROMPT,
      tools,
      env,
      cwd,
      maxTurns: 8,
      provider: modelProvider,
      complete,
    })
    return result?.stoppedReason === 'max_turns' ? 'max_turns' : state.finishReason ?? 'end_turn'
  })
}
