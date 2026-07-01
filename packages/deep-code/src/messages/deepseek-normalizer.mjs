import { omitUndefined } from '../utils/omitUndefined.mjs'
import { mergeSiblingAssistantMessages } from './mergeSiblingAssistantMessages.mjs'

export function mapMessagesToDeepSeek(messages, options = {}) {
  // reasoningReplay: whether to re-send assistant reasoning_content on tool-call
  // turns. Default true preserves DeepSeek's reasoning-trajectory continuation
  // (see deepseekHarnessPrompts). Set false to drop it (saves prompt tokens) once
  // a live cost probe justifies it — gated by the config knob, never flipped blind.
  const reasoningReplay = options.reasoningReplay ?? true
  const mapped = []
  // Merge same-message.id sibling assistant fragments (a resumed parallel-tool turn)
  // into one BEFORE mapping, else they map to assistant|assistant|tool|tool which
  // DeepSeek 400-rejects → permanent resume wedge. No-op for a normal live session
  // (one assistant per turn → nothing adjacent shares an id).
  for (const message of mergeSiblingAssistantMessages(messages)) {
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
  return dropDanglingToolCalls(dropOrphanToolMessages(mapped))
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

/**
 * Drop "dangling" assistant tool_calls — a `tool_calls` entry whose paired
 * `role:'tool'` result is missing from the request. This is the inverse of
 * dropOrphanToolMessages and the case its single forward pass cannot see.
 *
 * DeepSeek's API hard-rejects an assistant tool_calls message that is not
 * followed by a tool message for EVERY tool_call_id, so a single dangling call
 * 400s the whole request — and because the offending assistant message stays in
 * the transcript, every subsequent turn re-400s, permanently wedging the session.
 *
 * The live trigger is a session resumed/forked after a HARD crash that persisted
 * some but not all results of a multi-tool turn (the model requested tools X and
 * Y; only X's result reached disk). The resume-time filterUnresolvedToolUses
 * keeps such a message because not ALL its calls are unresolved, so the dangling
 * call survives to request-build. We drop the unpaired call rather than inject a
 * synthetic result, matching this module's drop-not-inject repair discipline.
 *
 * Runs AFTER dropOrphanToolMessages so "paired" is reckoned against the tool
 * results that actually survive — an out-of-order result already dropped as an
 * orphan does not falsely rescue its call. A fully-paired request (the common
 * case) is returned untouched, so the cached prefix stays byte-stable.
 */
function dropDanglingToolCalls(mapped) {
  const resolvedToolCallIds = new Set()
  for (const entry of mapped) {
    if (entry.role === 'tool' && entry.tool_call_id) {
      resolvedToolCallIds.add(entry.tool_call_id)
    }
  }
  return mapped.map(entry => {
    if (entry.role !== 'assistant' || !Array.isArray(entry.tool_calls)) {
      return entry
    }
    // Keep a call only if it can be positively paired with a surviving result. A
    // call with no id is left as-is (it can't be matched either way, and was
    // always passed through before — no happy-path byte change).
    const paired = entry.tool_calls.filter(
      call => !call?.id || resolvedToolCallIds.has(call.id),
    )
    if (paired.length === entry.tool_calls.length) return entry
    if (paired.length > 0) return { ...entry, tool_calls: paired }
    // Every call dangled: strip tool_calls and the reasoning that rode them,
    // leaving the (possibly empty) assistant text turn — which is pairing-neutral.
    return omitUndefined({
      ...entry,
      reasoning_content: undefined,
      tool_calls: undefined,
    })
  })
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

// DeepSeek (and the openai-compatible providers we target) are text-only — they
// cannot decode an image/document content block. Without this, the JSON.stringify
// fallthrough below would serialize the ENTIRE base64 blob as raw text into the
// prompt (a token/cost bomb with zero vision benefit), and a top-level image block
// in a user message would be dropped silently with no feedback. Return a compact,
// deterministic placeholder so the model is told what was elided and the bytes stay
// stable turn-over-turn. Returns null for blocks this doesn't recognize (the caller
// keeps its existing handling for those).
export function describeNonTextBlock(block) {
  const mediaType = block?.source?.media_type ?? block?.source?.mediaType
  if (block?.type === 'image') {
    return `[image omitted: DeepSeek has no vision${mediaType ? `; ${mediaType}` : ''}]`
  }
  if (block?.type === 'document') {
    return `[document omitted: DeepSeek has no vision${mediaType ? `; ${mediaType}` : ''}]`
  }
  return null
}

export function stringifyToolResultContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block?.type === 'text') return block.text ?? ''
      const placeholder = describeNonTextBlock(block)
      if (placeholder !== null) return placeholder
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
      continue
    }
    // A non-text block (a pasted image / PDF) can't be sent to a text-only model.
    // Emit a placeholder so the user gets a signal it was elided AND an image-only
    // turn still produces a non-empty user message instead of vanishing entirely.
    const placeholder = describeNonTextBlock(block)
    if (placeholder !== null) {
      textParts.push(placeholder)
    }
  }
  if (textParts.length > 0) {
    const userMsg = { role: 'user', content: textParts.join('\n') }
    // If this user message also carried tool_result(s) — the only entries pushed
    // onto `result` above — the synthesized user text must go AFTER the tool
    // messages. Each role:'tool' has to immediately follow the assistant
    // tool_calls it answers; an intervening user message breaks that adjacency
    // and DeepSeek/OpenAI reject the whole request with a 400, which persists in
    // the transcript and re-fails every subsequent turn (a permanent wedge).
    // Text-only and tool_result-only messages keep their exact prior shape
    // (result is empty so unshift==push, or there is no userMsg) — cache moat safe.
    if (result.length > 0) result.push(userMsg)
    else result.unshift(userMsg)
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
