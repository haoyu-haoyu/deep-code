import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'

// Message[] via CacheSafeParams (avoids a direct, raw-tsc-unresolvable
// ../../types/message.js import site).
type Message = CacheSafeParams['forkContextMessages'][number]
import { createUserMessage } from '../../utils/messages.js'
import {
  SUBAGENT_SYNTHESIS_PROMPT,
  parseSynthesisOutput,
  extractFilesTouched,
  buildSubagentSynthesisBlock,
} from './agentSynthesis.mjs'

// Optional LLM distillation of a FINISHED subagent transcript into a compact
// {findings, filesTouched, decisions, followups} block, used as the parent-visible
// result instead of the terse final message. It is a WARM-CACHE FORK: the subagent's
// own conversation (system + tools + messages) is already cache-hot, so re-sending it
// with a one-line synthesis prompt appended is ~93% cache hit — the same recipe as
// startAgentSummarization. Tools are denied via the canUseTool CALLBACK (NOT tools:[],
// which would bust the cache); maxOutputTokens is left unset (it clamps budget_tokens,
// a cache-key input); effort is forced to 'low' (free on V4, reasoning is filtered out).
//
// Returns the synthesis block, or null on ANY failure/timeout/empty — the caller then
// keeps the deterministic files-manifest fallback (no regression).

const SYNTHESIS_TIMEOUT_MS = 30_000

export async function synthesizeSubagentResult({
  agentMessages,
  cacheSafeParams,
  abortSignal,
}: {
  agentMessages: Message[]
  cacheSafeParams: CacheSafeParams
  abortSignal?: AbortSignal
}): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS)
  timeout.unref?.()
  const onParentAbort = () => controller.abort()
  if (abortSignal) {
    if (abortSignal.aborted) controller.abort()
    else abortSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  try {
    // Reuse the subagent's cache-safe params (system/tools/model/thinking) but swap
    // forkContextMessages to the FINISHED transcript, and force low effort additively
    // (preserve the rest of the app state) via the getAppState override.
    const baseGetAppState = cacheSafeParams.toolUseContext.getAppState
    const forkParams: CacheSafeParams = {
      ...cacheSafeParams,
      forkContextMessages: agentMessages,
    }

    const result = await runForkedAgent({
      promptMessages: [
        createUserMessage({ content: SUBAGENT_SYNTHESIS_PROMPT }),
      ],
      cacheSafeParams: forkParams,
      // Deny every tool via the callback (NOT tools:[]) so the prompt prefix bytes
      // stay byte-identical to the warm subagent prefix.
      canUseTool: async () => ({
        behavior: 'deny' as const,
        message: 'No tools needed for synthesis',
        decisionReason: { type: 'other' as const, reason: 'synthesis only' },
      }),
      querySource: 'agent_synthesis',
      forkLabel: 'agent_synthesis',
      overrides: {
        abortController: controller,
        getAppState: () => ({ ...baseGetAppState(), effortValue: 'low' }),
      },
      skipTranscript: true,
    })

    if (controller.signal.aborted) return null

    const text = extractSynthesisText(result.messages)
    const parsed = parseSynthesisOutput(text)
    if (!parsed) return null

    // filesTouched is ALWAYS the deterministic extraction — never LLM-derived — so a
    // hallucination can never invent a file path.
    const filesTouched = extractFilesTouched(agentMessages)
    const block = buildSubagentSynthesisBlock({ ...parsed, filesTouched })
    return block || null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    abortSignal?.removeEventListener('abort', onParentAbort)
  }
}

// The synthesis text is the fork's final assistant text block (one-shot, tools denied).
// Skips API-error messages and any prepended reasoning (we read only the text block).
function extractSynthesisText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.type !== 'assistant') continue
    if (message.isApiErrorMessage) continue
    const textBlock = message.message.content.find(
      block => block.type === 'text',
    )
    if (textBlock?.type === 'text' && textBlock.text.trim()) {
      return textBlock.text
    }
  }
  return ''
}
