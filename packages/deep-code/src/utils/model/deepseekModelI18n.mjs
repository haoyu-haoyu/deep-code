// Single source for the built-in DeepSeek /model picker labels + descriptions. Maps a model
// id to its i18n catalog keys AND the canonical English strings.
//
// modelOptions.ts uses the KEYS for the localized DISPLAY (getMessage) and the ENGLISH strings
// for `descriptionForModel` — which feeds the model-facing ConfigTool prompt (ConfigTool/
// prompt.ts) and so must stay byte-identical regardless of the user's UI locale: the model's
// input (and the DeepSeek cache prefix) must not shift because someone set their UI to zh/ja.
// en.ts mirrors these English strings (asserted by a parity test); zh-Hans/ja translate the
// description sentences (the brand/model-name labels stay English per the catalog convention).
const DEEPSEEK_MODELS = {
  auto: {
    seg: 'auto',
    label: 'Auto',
    description: 'Route each turn to DeepSeek Flash or Pro automatically',
  },
  'deepseek-chat': {
    seg: 'chat',
    label: 'DeepSeek Chat',
    description: 'Balanced DeepSeek model for everyday chat and coding tasks',
  },
  'deepseek-coder': {
    seg: 'coder',
    label: 'DeepSeek Coder',
    description: 'Code-focused DeepSeek model for implementation work',
  },
  'deepseek-reasoner': {
    seg: 'reasoner',
    label: 'DeepSeek Reasoner',
    description: 'Reasoning-focused DeepSeek model for complex tasks',
  },
  'deepseek-v4-pro': {
    seg: 'v4Pro',
    label: 'DeepSeek V4 Pro',
    description: '1M context · strongest Deep Code model for complex engineering work',
  },
  'deepseek-v4-flash': {
    seg: 'v4Flash',
    label: 'DeepSeek V4 Flash',
    description: '1M context · fast lightweight model for small edits, summaries, and subagents',
  },
}

// The display string for a model the catalog doesn't recognize (also localized via its key).
export const DEEPSEEK_CUSTOM_MODEL_DESCRIPTION = 'Custom DeepSeek-compatible model'
export const DEEPSEEK_CUSTOM_MODEL_DESCRIPTION_KEY = 'model.deepseek.custom.description'

// id -> { labelKey, descriptionKey, englishLabel, englishDescription } for a built-in model,
// or null for an unknown/custom id (the caller shows the raw id + the custom description).
export function deepseekModelI18n(id) {
  const entry = typeof id === 'string' ? DEEPSEEK_MODELS[id.toLowerCase()] : undefined
  if (!entry) return null
  return {
    labelKey: `model.deepseek.${entry.seg}.label`,
    descriptionKey: `model.deepseek.${entry.seg}.description`,
    englishLabel: entry.label,
    englishDescription: entry.description,
  }
}

// All built-in entries — used by the en.ts<->leaf parity test (the catalog must carry the
// exact English strings so an en-locale user sees no change).
export function deepseekModelI18nEntries() {
  return Object.values(DEEPSEEK_MODELS).map(entry => ({
    seg: entry.seg,
    labelKey: `model.deepseek.${entry.seg}.label`,
    descriptionKey: `model.deepseek.${entry.seg}.description`,
    englishLabel: entry.label,
    englishDescription: entry.description,
  }))
}
