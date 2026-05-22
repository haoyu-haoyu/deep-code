/**
 * DeepSeek-build stub for Anthropic model capability probing.
 *
 * The legacy implementation fetched Anthropic model metadata through
 * services/api/client. P1.3.F.b deletes that wrapper, so capability refresh is a
 * no-op and synchronous lookups fall back to existing static defaults.
 */

export type ModelCapability = {
  id: string
  max_input_tokens?: number
  max_tokens?: number
}

export function getModelCapability(_model: string): ModelCapability | undefined {
  return undefined
}

export async function refreshModelCapabilities(): Promise<void> {
  return
}
