import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  DEFAULT_MODEL_PROVIDER,
  MODEL_PROVIDER_NAMES,
  formatModelProviderNames,
  isModelProviderName,
  normalizeModelProviderName,
} from '../../services/providers/registry.mjs'
import { mergeProviderConfigPartial } from '../../services/providers/deepseek-config-store.mjs'
import { getMessage } from '../../i18n/index.js'

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
      value: getMessage('command.provider.current', {
        current,
        validProviders,
      }),
    }
  }

  if (COMMON_HELP_ARGS.has(raw)) {
    return {
      type: 'text',
      value: getMessage('command.provider.usage', {
        usageLabel: PROVIDER_USAGE_LABEL,
        validProviders,
      }),
    }
  }

  const [providerArg, baseUrl] = raw.split(/\s+/, 2)
  const provider = normalizeModelProviderName(providerArg)
  if (provider === 'anthropic' || provider === 'claude') {
    return {
      type: 'text',
      value: getMessage('command.provider.legacyOnly', {
        provider,
        validProviders,
      }),
    }
  }

  if (!isModelProviderName(provider)) {
    return {
      type: 'text',
      value: getMessage('command.provider.invalid', {
        raw,
        validProviders,
      }),
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
      ? getMessage('command.provider.setWithBaseUrl', { provider })
      : getMessage('command.provider.set', { provider }),
  }
}

export const call: LocalCommandCall = async args => {
  return executeProviderCommand(args)
}

export const PROVIDER_COMMAND_CHOICES = MODEL_PROVIDER_NAMES
