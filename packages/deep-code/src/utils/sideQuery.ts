import type { QuerySource } from '../constants/querySource.js'

/**
 * DeepSeek-build stub for side queries.
 *
 * Legacy side queries were backed by the Anthropic SDK and
 * services/api/{claude,client}. Those wrappers are deleted in P1.3.F.b, so this
 * module preserves the caller-facing shape while returning an empty response
 * that existing fallback paths can handle without API traffic.
 */

export type SideQueryOptions = {
  model: string
  system?: unknown
  messages?: ReadonlyArray<unknown>
  tools?: ReadonlyArray<unknown>
  tool_choice?: unknown
  output_format?: unknown
  max_tokens?: number
  maxRetries?: number
  signal?: AbortSignal
  skipSystemPromptPrefix?: boolean
  temperature?: number
  thinking?: number | false
  stop_sequences?: ReadonlyArray<string>
  querySource: QuerySource | string
  [key: string]: unknown
}

export type SideQueryTextBlock = {
  type: 'text'
  text: string
}

export type SideQueryToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type SideQueryContentBlock = SideQueryTextBlock | SideQueryToolUseBlock

export type SideQueryResult = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: SideQueryContentBlock[]
  stop_reason: 'end_turn' | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export async function sideQuery(
  opts: SideQueryOptions,
): Promise<SideQueryResult> {
  return {
    id: 'deepseek-side-query-stub',
    type: 'message',
    role: 'assistant',
    model: opts.model,
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }
}
