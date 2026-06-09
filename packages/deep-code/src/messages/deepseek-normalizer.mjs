import { omitUndefined } from '../utils/omitUndefined.mjs'

export function mapMessagesToDeepSeek(messages, options = {}) {
  // reasoningReplay: whether to re-send assistant reasoning_content on tool-call
  // turns. Default true preserves DeepSeek's reasoning-trajectory continuation
  // (see deepseekHarnessPrompts). Set false to drop it (saves prompt tokens) once
  // a live cost probe justifies it — gated by the config knob, never flipped blind.
  const reasoningReplay = options.reasoningReplay ?? true
  const mapped = []
  for (const message of messages) {
    if (!message) continue

    if (message.role) {
      mapped.push(...mapOpenAIStyleMessage(message, { reasoningReplay }))
      continue
    }

    if (message.type === 'user') {
      mapped.push(...mapClaudeCodeUserMessage(message))
      continue
    }

    if (message.type === 'assistant') {
      mapped.push(mapClaudeCodeAssistantMessage(message, { reasoningReplay }))
    }
  }
  return dropOrphanToolMessages(mapped)
}

/**
 * Drop orphan `role:'tool'` messages whose tool_call_id was never produced by a
 * preceding assistant `tool_calls` entry in this request.
 *
 * This happens when the request's leading turns were summarized away — e.g. a
 * partial-compaction kept-tail that starts with a tool_result whose originating
 * assistant tool_use is now in the summary, or a session resumed/forked mid-turn.
 * DeepSeek's API strictly requires every tool message to pair with a preceding
 * assistant tool_call, so an orphan both hard-rejects the request AND breaks the
 * prefix cache. Stripping is deterministic (same every turn), so the post-reset
 * prefix stays byte-stable. (Reasonix avoids the orphan by moving the compaction
 * boundary; we repair it at request-build time, which also covers resume/fork.)
 */
function dropOrphanToolMessages(mapped) {
  const seenToolCallIds = new Set()
  const out = []
  for (const entry of mapped) {
    if (entry.role === 'assistant' && Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        if (call?.id) seenToolCallIds.add(call.id)
      }
      out.push(entry)
      continue
    }
    if (entry.role === 'tool') {
      // Keep only tool results whose call was produced by an earlier assistant.
      if (entry.tool_call_id && seenToolCallIds.has(entry.tool_call_id)) {
        out.push(entry)
      }
      continue
    }
    out.push(entry)
  }
  return out
}

export function normalizeToolCalls(toolCalls) {
  return (toolCalls ?? []).map(call => ({
    id: call.id,
    type: 'function',
    function: {
      name: call.function?.name ?? call.name,
      arguments:
        typeof call.function?.arguments === 'string'
          ? call.function.arguments
          : typeof call.arguments === 'string'
            ? call.arguments
            : JSON.stringify(call.input ?? {}),
    },
  }))
}

export function stringifyToolResultContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      return JSON.stringify(block)
    })
    .join('\n')
}

function mapOpenAIStyleMessage(message, { reasoningReplay = true } = {}) {
  if (message.role === 'assistant') {
    const toolCalls = normalizeToolCalls(message.tool_calls)
    return [
      omitUndefined({
        role: 'assistant',
        content: message.content ?? '',
        reasoning_content:
          reasoningReplay && toolCalls.length > 0
            ? message.reasoning_content
            : undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        name: message.name,
      }),
    ]
  }

  if (message.role === 'tool') {
    return [
      {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: stringifyToolResultContent(message.content),
      },
    ]
  }

  return [
    omitUndefined({
      role: message.role,
      content: stringifyTextContent(message.content),
      name: message.name,
    }),
  ]
}

function mapClaudeCodeUserMessage(message) {
  const content = message.message?.content ?? message.content
  if (!Array.isArray(content)) {
    return [{ role: 'user', content: String(content ?? '') }]
  }

  const result = []
  const textParts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'tool_result') {
      result.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: stringifyToolResultContent(block.content),
      })
      continue
    }
    if (block.type === 'text') {
      textParts.push(block.text ?? '')
    }
  }
  if (textParts.length > 0) {
    result.unshift({ role: 'user', content: textParts.join('\n') })
  }
  return result
}

function mapClaudeCodeAssistantMessage(message, { reasoningReplay = true } = {}) {
  const content = message.message?.content ?? message.content
  if (!Array.isArray(content)) {
    return { role: 'assistant', content: String(content ?? '') }
  }

  const textParts = []
  const reasoningParts = []
  const toolCalls = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text') {
      textParts.push(block.text ?? '')
    } else if (block.type === 'thinking') {
      reasoningParts.push(block.thinking ?? '')
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {}),
        },
      })
    }
  }

  return omitUndefined({
    role: 'assistant',
    content: textParts.join(''),
    reasoning_content:
      reasoningReplay && toolCalls.length > 0 && reasoningParts.length > 0
        ? reasoningParts.join('\n')
        : undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  })
}

function stringifyTextContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .filter(block => block?.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}
