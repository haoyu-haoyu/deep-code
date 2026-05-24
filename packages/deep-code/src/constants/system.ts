// Critical system constants extracted to break circular dependencies

import { getAPIProvider } from '../utils/model/providers.js'

const DEFAULT_PREFIX = `You are Deep Code, a DeepSeek-native CLI coding assistant.`
const AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX = `You are Deep Code, a DeepSeek-native CLI coding assistant, running within the Deep Code Agent SDK.`
const AGENT_SDK_PREFIX = `You are a Deep Code agent, built on the Deep Code Agent SDK.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

/**
 * Get attribution header for API requests.
 * DeepSeek builds do not send Anthropic billing/attribution headers.
 */
export function getAttributionHeader(_fingerprint: string): string {
  return ''
}
