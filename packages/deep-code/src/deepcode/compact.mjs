import {
  buildDeepSeekRequest,
  collectDeepSeekStreamEvents,
  createDeepSeekProvider,
  resolveDeepSeekConfig,
} from '../services/providers/deepseek.mjs'
import { createDeepSeekCacheDiagnostics } from '../cache/deepseek-cache.mjs'
import { createDeepCodeStablePrefix } from './stable-prefix.mjs'
import { providerSupports } from './provider-capabilities.mjs'
import { omitUndefined } from '../utils/omitUndefined.mjs'
import { parsePositiveIntOr } from '../utils/configValue.mjs'

export async function compactDeepCodeConversation({
  messages = [],
  stablePrefix,
  env = process.env,
  cwd = process.cwd(),
  provider,
  maxTokens,
  signal,
} = {}) {
  const modelProvider = provider ?? createDeepSeekProvider()
  const prefix =
    stablePrefix ?? (await createDeepCodeStablePrefix({ provider: modelProvider }))
  const config = resolveDeepSeekConfig({ env, cwd })
  const requestContext = omitUndefined({
    systemPrompt: prefix.systemPrompt,
    messages: [
      {
        role: 'user',
        content: buildCompactPrompt(messages),
      },
    ],
    env,
    cwd,
    model: config.smallModel,
    // parsePositiveIntOr (not bare Number): Number('') === 0 and Number('lots') === NaN would
    // reach the request as a broken max_tokens; a non-positive-integer env value falls back to
    // 1024 instead. Unset env → 1024, identical to the old `?? 1024` default.
    maxTokens: parsePositiveIntOr(
      maxTokens ??
        env.DEEPCODE_COMPACT_MAX_TOKENS ??
        env.DEEPSEEK_COMPACT_MAX_TOKENS,
      1024,
    ),
    thinking: providerSupports(modelProvider, 'extended_thinking')
      ? 'disabled'
      : undefined,
  })
  const request =
    typeof modelProvider.buildRequest === 'function'
      ? await modelProvider.buildRequest(requestContext)
      : await buildDeepSeekRequest(requestContext)
  const response = await collectDeepSeekStreamEvents(
    // Thread the abort signal so a mid-turn Ctrl-C can cancel /compact's
    // streaming call (streamQuery reads context.signal; undefined is a no-op).
    modelProvider.streamQuery({ ...request, signal }),
  )

  // An empty/whitespace-only summary is a FAILURE, not a "compact to nothing"
  // result. The stream can complete successfully with no content (a reasoning-only
  // completion, or a proxy/network glitch that drops the content `data:` lines while
  // `[DONE]` still arrives — parseDeepSeekSSELines deliberately skips malformed
  // lines rather than aborting). Returning `messages: []` here would make the caller
  // splice an empty array over the live conversation, silently destroying the whole
  // session history. Throw loudly instead — both callers (the interactive /compact
  // handler and the --compact subcommand) handle a thrown error by leaving history
  // untouched, mirroring the full-CLI services/compact contract. An aborted stream
  // throws AbortError above this point, so Ctrl-C is never mislabeled.
  if (!isUsableCompactSummary(response.content)) {
    throw new Error(
      'Failed to generate conversation summary: the model returned no summary text. Conversation history is unchanged.',
    )
  }
  const summary = response.content.trim()

  return {
    prefixBeforeHash: prefix.prefixHash,
    prefixAfterHash: prefix.prefixHash,
    summary,
    messages: [
      {
        role: 'user',
        content: `Compacted conversation summary:\n${summary}`,
      },
    ],
    finishReason: response.finishReason,
    usage: response.usage,
    cacheDiagnostics: providerSupports(modelProvider, 'cache_breakpoint') && response.usage
      ? createDeepSeekCacheDiagnostics(response.usage)
      : null,
    request,
  }
}

// A compaction summary is only usable if it has non-whitespace content. An empty
// summary means the model produced no text (filtered/reasoning-only completion, or
// dropped content lines) — treating it as usable would clear the conversation.
export function isUsableCompactSummary(content) {
  return Boolean(content && content.trim())
}

export function formatDeepCodeCompactResult(result) {
  const diagnostics = result.cacheDiagnostics
  const hit = diagnostics?.promptCacheHitTokens ?? 0
  const miss = diagnostics?.promptCacheMissTokens ?? 0
  const hitRate = diagnostics
    ? `${(diagnostics.promptCacheHitRate * 100).toFixed(1)}%`
    : 'unknown'

  return [
    'DeepSeek prefix-preserving compact',
    `Stable prefix hash: ${result.prefixBeforeHash} -> ${result.prefixAfterHash}`,
    `Finish reason: ${result.finishReason ?? 'unknown'}`,
    `Summary chars: ${result.summary.length}`,
    `Post-compact messages: ${result.messages.length}`,
    diagnostics ? `Cache: hit=${hit} miss=${miss} hit_rate=${hitRate}` : '',
  ].filter(Boolean).join('\n')
}

function buildCompactPrompt(messages) {
  return [
    'Summarize the following volatile conversation tail for continuation.',
    [
      'Keep concrete user goals, decisions, file paths, commands, test results,',
      'tool outcomes, blockers, and next steps.',
    ].join(' '),
    [
      'Do not restate stable system instructions, tool manifests, skills',
      'manifests, or repository summary; those remain in the Deep Code stable prefix.',
    ].join(' '),
    'Return only the compact summary text.',
    '',
    'Conversation tail:',
    JSON.stringify(messages, null, 2),
  ].join('\n')
}
