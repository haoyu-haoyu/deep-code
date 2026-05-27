export const DEEPCODE_PROVIDER_CAPABILITIES = Object.freeze({
  CACHE_BREAKPOINT: 'cache_breakpoint',
  EXTENDED_THINKING: 'extended_thinking',
  REASONING_EFFORT: 'reasoning_effort',
  REASONING_CONTENT: 'reasoning_content',
  STABLE_PREFIX_CACHE: 'stable_prefix_cache',
  STRICT_TOOL_SCHEMA: 'strict_tool_schema',
  USER_ID: 'user_id',
})

const CAPABILITY_ALIASES = Object.freeze({
  cache_breakpoint: Object.freeze(['cache_diagnostics']),
  extended_thinking: Object.freeze(['reasoning_content']),
  reasoning_effort: Object.freeze(['reasoning_content']),
  stable_prefix_cache: Object.freeze(['cache_diagnostics']),
  strict_tool_schema: Object.freeze(['strict_tools']),
  user_id: Object.freeze(['cache_diagnostics']),
})

export function providerSupports(provider, capability) {
  if (!provider || typeof provider.supports !== 'function') return true
  if (provider.supports(capability)) return true

  for (const alias of CAPABILITY_ALIASES[capability] ?? []) {
    if (provider.supports(alias)) return true
  }

  return false
}

export function createProviderCapabilitySnapshot(provider) {
  return Object.fromEntries(
    Object.values(DEEPCODE_PROVIDER_CAPABILITIES).map(capability => [
      capability,
      providerSupports(provider, capability),
    ]),
  )
}
