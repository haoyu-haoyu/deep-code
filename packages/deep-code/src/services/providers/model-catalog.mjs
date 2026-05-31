// Config-driven DeepSeek model catalog.
//
// Built-ins are grounded in what the live DeepSeek API actually serves: only
// `deepseek-v4-pro` and `deepseek-v4-flash` are real, distinct models. The
// legacy aliases (deepseek-chat / deepseek-coder / deepseek-reasoner) are
// accepted by the API but silently downgrade to flash, so surfacing them as
// separate selectable models would mislead — they are intentionally omitted.
//
// To add a model — a custom OpenAI-compatible endpoint's model, or a future
// DeepSeek model — the user edits the `models` array in the provider config
// (~/.deepcode/deepseek-config.json). That makes "add a model" a config
// change, not a code change (the Reasonix config-driven registry idea, applied
// to the model dimension; providers are already config-driven via registry.mjs
// and the /provider command).
//
// This module is pure + side-effect free (no fs): fully unit-testable. The thin
// load-and-merge convenience that reads the config file from disk lives in
// deepseek-config-store.mjs (getResolvedDeepSeekModelCatalog) to keep this
// module free of I/O and avoid an import cycle.

export const DEEPSEEK_BUILTIN_MODELS = Object.freeze([
  Object.freeze({
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description:
      '1M context · strongest Deep Code model for complex engineering work',
  }),
  Object.freeze({
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description:
      '1M context · fast lightweight model for small edits, summaries, and subagents',
  }),
])

/**
 * Validate + normalize a raw `models` value (from config or env) into catalog
 * entries. Accepts an array whose items are either a bare model-id string or an
 * object `{ id, label?, description? }`. Drops anything without a usable string
 * id, trims fields, de-dupes by case-insensitive id (first occurrence wins),
 * and caps the count. Returns `[]` for a non-array input.
 *
 * @param {unknown} value
 * @param {{ max?: number }} [options]
 * @returns {Array<{ id: string, label?: string, description?: string }>}
 */
export function sanitizeModelCatalogEntries(value, { max = 50 } = {}) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const entries = []
  for (const raw of value) {
    const entry = normalizeCatalogEntry(raw)
    if (!entry) continue
    const key = entry.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
    if (entries.length >= max) break
  }
  return entries
}

function normalizeCatalogEntry(raw) {
  let id
  let label
  let description
  if (typeof raw === 'string') {
    id = raw
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    ;({ id, label, description } = raw)
  } else {
    return null
  }
  if (typeof id !== 'string') return null
  id = id.trim()
  if (id === '') return null

  const entry = { id }
  if (typeof label === 'string' && label.trim() !== '') {
    entry.label = label.trim()
  }
  if (typeof description === 'string' && description.trim() !== '') {
    entry.description = description.trim()
  }
  return entry
}

/**
 * Merge the built-in DeepSeek models with user-defined models from config.
 *
 * - A config entry whose id matches a built-in (case-insensitive) OVERRIDES
 *   that built-in's label/description while keeping the built-in's canonical id
 *   casing and position. This lets a user re-label/re-describe a built-in.
 * - Config-only ids are appended after the built-ins, in config order.
 * - Order is stable and deterministic (prefix-cache friendly): built-ins in
 *   their canonical order, then config-only models.
 *
 * @param {{ fileConfig?: { models?: unknown }, includeBuiltins?: boolean }} [options]
 * @returns {Array<{ id: string, label?: string, description?: string }>}
 */
export function getDeepSeekModelCatalog({
  fileConfig,
  includeBuiltins = true,
} = {}) {
  const configEntries = sanitizeModelCatalogEntries(fileConfig?.models)
  const overrides = new Map(configEntries.map(e => [e.id.toLowerCase(), e]))

  const catalog = []
  const placed = new Set()

  if (includeBuiltins) {
    for (const builtin of DEEPSEEK_BUILTIN_MODELS) {
      const key = builtin.id.toLowerCase()
      const override = overrides.get(key)
      // Override label/description but keep the built-in's canonical id casing.
      catalog.push(override ? { ...builtin, ...override, id: builtin.id } : { ...builtin })
      placed.add(key)
    }
  }

  for (const entry of configEntries) {
    const key = entry.id.toLowerCase()
    if (placed.has(key)) continue
    catalog.push({ ...entry })
    placed.add(key)
  }

  return catalog
}

/**
 * Look up a catalog entry by id (case-insensitive), returning an entry with a
 * guaranteed label + description. Synthesizes a sensible fallback for an id not
 * present in the catalog (e.g. a custom model the user is currently running but
 * has not declared in `models`).
 *
 * @param {string} id
 * @param {Array<{ id: string, label?: string, description?: string }>} [catalog]
 * @returns {{ id: string, label: string, description: string }}
 */
export function resolveModelCatalogEntry(id, catalog = DEEPSEEK_BUILTIN_MODELS) {
  const wanted = String(id ?? '').trim()
  const match = catalog.find(e => e.id.toLowerCase() === wanted.toLowerCase())
  if (match) {
    return {
      id: match.id,
      label: match.label ?? match.id,
      description: match.description ?? 'DeepSeek-compatible model',
    }
  }
  return {
    id: wanted,
    label: wanted,
    description: 'Custom DeepSeek-compatible model',
  }
}
