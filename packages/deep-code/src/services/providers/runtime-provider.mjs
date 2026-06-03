import { createDeepSeekProvider } from './deepseek.mjs'
import { resolveProviderConfig } from './provider-config.mjs'
import {
  DEFAULT_MODEL_PROVIDER,
  normalizeModelProviderName,
  resolveModelProvider,
} from './registry.mjs'

// Resolve the model provider the runtime's main query loop should use, from
// config (env DEEPCODE_PROVIDER / provider config file activeProvider, plus the
// matching baseUrl/apiKey/model). This is the single seam that turns the
// previously-latent provider registry into the runtime's actual provider.
//
// CACHE-MOAT / BYTE-IDENTICAL INVARIANT: the DEFAULT (no provider configured, or
// 'deepseek') returns the exact same createDeepSeekProvider() the call model
// hard-defaulted to before this wiring — so the DeepSeek request, the stable
// prefix, and the prompt-cache moat are completely unchanged. Only an explicit
// non-deepseek provider switches the path; everything in createDeepSeekCallModel
// is already capability-gated (stable_prefix_cache / reasoning_effort /
// cache_breakpoint via providerSupports), so a non-DeepSeek provider streams
// correctly without DeepSeek-only request fields.
export function resolveRuntimeModelProvider({ env = process.env, fileConfig } = {}) {
  const config = resolveProviderConfig({ env, fileConfig })

  if (normalizeModelProviderName(config.provider) === DEFAULT_MODEL_PROVIDER) {
    return createDeepSeekProvider()
  }

  return resolveModelProvider({
    env,
    name: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
  })
}

// Is this the DeepSeek provider? Auto-routing (model='auto') is DeepSeek-specific
// — it routes among deepseek models — so it must ONLY engage when the resolved
// provider is DeepSeek. For any other configured provider, 'auto' is a normal
// request to that provider; routing it would silently send the user's data to
// DeepSeek instead of where they configured.
export function isDeepSeekProvider(provider) {
  // Guard the empty/missing name explicitly: normalizeModelProviderName() treats
  // a falsy name as the DEFAULT ('deepseek'), so without this a provider with no
  // name would be mis-classified as DeepSeek (and wrongly allowed to auto-route).
  const name = provider?.name
  return Boolean(name) && normalizeModelProviderName(name) === DEFAULT_MODEL_PROVIDER
}
