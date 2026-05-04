export const MODEL_PROVIDER_METHODS = Object.freeze([
  'streamQuery',
  'buildRequest',
  'parseStreamChunk',
  'mapUsage',
  'supports',
])

export const MODEL_PROVIDER_CAPABILITIES = Object.freeze({
  CACHE_DIAGNOSTICS: 'cache_diagnostics',
  JSON_OUTPUT: 'json_output',
  REASONING_CONTENT: 'reasoning_content',
  STRICT_TOOLS: 'strict_tools',
  STREAMING: 'streaming',
  TOOL_CALLS: 'tool_calls',
})

export function assertModelProvider(provider) {
  for (const method of MODEL_PROVIDER_METHODS) {
    if (typeof provider?.[method] !== 'function') {
      throw new TypeError(`Model provider is missing ${method}()`)
    }
  }
  return provider
}

export function createUnsupportedProvider(name, reason) {
  return assertModelProvider({
    name,
    async *streamQuery() {
      throw new Error(reason)
    },
    async buildRequest() {
      throw new Error(reason)
    },
    parseStreamChunk() {
      throw new Error(reason)
    },
    mapUsage() {
      throw new Error(reason)
    },
    supports() {
      return false
    },
  })
}
