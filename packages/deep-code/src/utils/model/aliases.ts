export const MODEL_ALIASES = [
  'deepseek-chat',
  'deepseek-coder',
  'deepseek-reasoner',
  'best',
] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(modelInput: string): modelInput is ModelAlias {
  return MODEL_ALIASES.includes(modelInput as ModelAlias)
}

/**
 * Bare model family aliases that act as wildcards in the availableModels allowlist.
 * When a DeepSeek family is in the allowlist, any matching model in that family is allowed.
 * When a specific model ID is in the allowlist, only that exact version is allowed.
 */
export const MODEL_FAMILY_ALIASES = [
  'deepseek-chat',
  'deepseek-coder',
  'deepseek-reasoner',
] as const

export function isModelFamilyAlias(model: string): boolean {
  return (MODEL_FAMILY_ALIASES as readonly string[]).includes(model)
}
