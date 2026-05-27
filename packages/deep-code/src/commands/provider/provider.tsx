import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  DEFAULT_MODEL_PROVIDER,
  MODEL_PROVIDER_NAMES,
  formatModelProviderNames,
  isModelProviderName,
  normalizeModelProviderName,
} from '../../services/providers/registry.mjs'
import { mergeProviderConfigPartial } from '../../services/providers/deepseek-config-store.mjs'

const COMMON_HELP_ARGS = new Set(['help', '-h', '--help'])
const PROVIDER_USAGE_LABEL = 'deepseek/ollama/vllm/openai-compatible'

export function executeProviderCommand(
  args = '',
  env: NodeJS.ProcessEnv = process.env,
): LocalCommandResult {
  const raw = args.trim()
  const current = normalizeModelProviderName(
    env.DEEPCODE_PROVIDER ?? env.DEEP_CODE_PROVIDER ?? DEFAULT_MODEL_PROVIDER,
  )
  const validProviders = formatModelProviderNames()

  if (!raw || raw === 'current' || raw === 'status') {
    return {
      type: 'text',
      value: `Current provider: ${current}\nValid providers: ${validProviders}`,
    }
  }

  if (COMMON_HELP_ARGS.has(raw)) {
    return {
      type: 'text',
      value: `Usage: /provider [${PROVIDER_USAGE_LABEL}]\n\nValid providers: ${validProviders}`,
    }
  }

  const [providerArg, baseUrl] = raw.split(/\s+/, 2)
  const provider = normalizeModelProviderName(providerArg)
  if (provider === 'anthropic' || provider === 'claude') {
    return {
      type: 'text',
      value: `${provider} is legacy-only, not supported. Valid providers: ${validProviders}`,
    }
  }

  if (!isModelProviderName(provider)) {
    return {
      type: 'text',
      value: `Invalid provider: ${raw}. Valid providers: ${validProviders}`,
    }
  }

  env.DEEPCODE_PROVIDER = provider
  mergeProviderConfigPartial(
    provider,
    baseUrl ? { baseUrl } : {},
    { env },
  )
  return {
    type: 'text',
    value: baseUrl
      ? `Provider set to ${provider} (base URL saved)`
      : `Provider set to ${provider}`,
  }
}

export const call: LocalCommandCall = async args => {
  return executeProviderCommand(args)
}

export const PROVIDER_COMMAND_CHOICES = MODEL_PROVIDER_NAMES
