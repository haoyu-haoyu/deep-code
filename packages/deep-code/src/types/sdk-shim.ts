/**
 * P1.8.0 local SDK type shim scaffold.
 *
 * Path C in P1_8_DESIGN.md keeps SDK-derived structural types local while
 * runtime error classes live in utils/sdkErrors.ts. This module is self-contained
 * by design: it does not import from or re-export the upstream SDK package.
 */

export type CacheControlEphemeral = {
  type: 'ephemeral'
  scope?: 'global' | 'org'
  ttl?: '5m' | '1h'
}

export type Base64ImageSource = {
  type: 'base64'
  media_type: string
  data: string
}

export type URLImageSource = {
  type: 'url'
  url: string
}

export type ImageSource = Base64ImageSource | URLImageSource

export type TextBlockParam = {
  type: 'text'
  text: string
  cache_control?: CacheControlEphemeral | null
}

export type ImageBlockParam = {
  type: 'image'
  source: ImageSource
  cache_control?: CacheControlEphemeral | null
}

export type ToolUseBlockParam = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
  cache_control?: CacheControlEphemeral | null
}

export type ToolResultBlockContent = TextBlockParam | ImageBlockParam

export type ToolResultBlockParam = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | ToolResultBlockContent[]
  is_error?: boolean
  cache_control?: CacheControlEphemeral | null
}

export type ThinkingBlockParam = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type RedactedThinkingBlockParam = {
  type: 'redacted_thinking'
  data: string
}

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam

export type TextBlock = TextBlockParam
export type ImageBlock = ImageBlockParam

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type RedactedThinkingBlock = {
  type: 'redacted_thinking'
  data: string
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock

export type MessageParam = {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

export namespace Anthropic {
  export namespace Tool {
    export type InputSchema = {
      type?: 'object'
      properties?: Record<string, unknown>
      required?: string[]
      [key: string]: unknown
    }
  }
}

export type BetaContentBlock = ContentBlock

export type BetaServerToolUse = {
  web_search_requests?: number
  web_fetch_requests?: number
}

export type BetaCacheCreation = {
  ephemeral_1h_input_tokens?: number
  ephemeral_5m_input_tokens?: number
}

export type BetaUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  server_tool_use?: BetaServerToolUse
  service_tier?: string
  cache_creation?: BetaCacheCreation
}

export type BetaToolUseBlock = ToolUseBlock

export type BetaMessage = {
  id?: string
  role: 'assistant'
  content: BetaContentBlock[]
  model?: string
  stop_reason?: string | null
  stop_sequence?: string | null
  usage?: BetaUsage
}

export type BetaThinkingBlock = ThinkingBlock
export type BetaRedactedThinkingBlock = RedactedThinkingBlock

export type BetaTool = {
  name: string
  description?: string
  input_schema: Anthropic.Tool.InputSchema
  cache_control?: CacheControlEphemeral | null
  [key: string]: unknown
}

export type BetaWebSearchUserLocation = {
  type?: 'approximate'
  city?: string
  region?: string
  country?: string
  timezone?: string
}

export type BetaWebSearchTool20250305 = {
  name: 'web_search'
  type: 'web_search_20250305'
  max_uses?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
  user_location?: BetaWebSearchUserLocation
  cache_control?: CacheControlEphemeral | null
}

export type BetaToolUnion =
  | BetaTool
  | BetaWebSearchTool20250305
  | (BetaTool & { type?: string })

export type BetaMessageStreamParams = {
  max_tokens: number
  model: string
  messages: MessageParam[]
  system?: string | TextBlockParam[]
  tools?: BetaToolUnion[]
  betas?: string[]
  metadata?: Record<string, unknown>
  service_tier?: string
  stop_sequences?: string[]
  stream?: boolean
  temperature?: number
  thinking?: Record<string, unknown>
  tool_choice?: Record<string, unknown>
  top_k?: number
  top_p?: number
  [key: string]: unknown
}

export type APIError = Error & {
  status?: number
  error?: unknown
  headers?: Record<string, string> | globalThis.Headers
}
