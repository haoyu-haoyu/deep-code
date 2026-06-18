import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  getDeepSeekModelCatalog,
  sanitizeModelCatalogEntries,
} from './model-catalog.mjs'
import {
  SECURE_DIR_MODE,
  SECURE_FILE_MODE,
  isModeTooOpen,
} from '../../utils/secureFileMode.mjs'

const CONFIG_FILENAME = 'deepseek-config.json'

// The config file holds the API key (and the dir may have been created by a loose
// umask before this hardening, or by another tool). Repair a group/world-accessible
// path back to owner-only: the key file to 0o600 on read, the ~/.deepcode dir to
// 0o700 on save. POSIX-only (chmod is a no-op on Windows) and best-effort — a
// stat/chmod failure must never break config loading or saving.
function enforceSecureMode(path, secureMode) {
  if (process.platform === 'win32') return
  try {
    if (isModeTooOpen(statSync(path).mode)) {
      chmodSync(path, secureMode)
    }
  } catch {
    // stat/chmod can race or be denied; the caller proceeds regardless.
  }
}

export function resolveDeepSeekConfigPath({ env = process.env } = {}) {
  const explicit = env.DEEPCODE_CONFIG_FILE ?? env.DEEPSEEK_CONFIG_FILE
  if (explicit) return explicit

  const dir =
    env.DEEPCODE_CONFIG_DIR ??
    env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.deepcode')
  return join(dir, CONFIG_FILENAME)
}

export function loadDeepSeekConfigFile({ env = process.env } = {}) {
  const path = resolveDeepSeekConfigPath({ env })
  if (!existsSync(path)) return null
  enforceSecureMode(path, SECURE_FILE_MODE)
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return extractDeepSeekConfig(parsed)
  } catch {
    return null
  }
}

export function saveDeepSeekConfigFile(config, { env = process.env } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('DeepSeek config must be a plain object')
  }
  const path = resolveDeepSeekConfigPath({ env })
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE })
  } else {
    // An existing ~/.deepcode created before this hardening (or by another tool)
    // may be group/world-accessible; tighten it to 0o700 too.
    enforceSecureMode(dir, SECURE_DIR_MODE)
  }
  const persisted = {
    // Spread the incoming config FIRST so forward-compatible keys written by a
    // NEWER DeepCode version survive a downgrade save (an older binary loading
    // and re-saving the file must not silently destroy fields it doesn't know
    // about). Object spread copies an own `__proto__` data key from JSON.parse
    // as plain data without invoking the prototype setter. The validated known
    // fields below overwrite their spread values in place.
    ...config,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : undefined,
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : undefined,
    model: typeof config.model === 'string' ? config.model : undefined,
    smallModel:
      typeof config.smallModel === 'string' ? config.smallModel : undefined,
    reasoningEffort:
      typeof config.reasoningEffort === 'string'
        ? config.reasoningEffort
        : undefined,
    thinking:
      typeof config.thinking === 'string' ? config.thinking : undefined,
    reasoningReplay:
      typeof config.reasoningReplay === 'boolean'
        ? config.reasoningReplay
        : undefined,
    models: normalizeCatalogModels(config.models),
    completedAt: new Date().toISOString(),
  }
  for (const key of Object.keys(persisted)) {
    if (persisted[key] === undefined) delete persisted[key]
  }
  // Atomic write: tmp file in same dir created with mode 0o600 from the
  // first byte (no chmod-after-write window where the API key would sit on
  // disk world-readable). On any error the tmp file is unlinked and the
  // existing config file is left untouched.
  const tmpPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    // Best-effort hardening for any platform/umask combo that ignored the
    // mode hint above. POSIX-only and safe to fail silently.
    try {
      chmodSync(tmpPath, 0o600)
    } catch {}
    renameSync(tmpPath, path)
  } catch (error) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // Tmp file may not exist if writeFileSync failed before opening.
    }
    throw error
  }
  return path
}

export function mergeDeepSeekConfigPartial(partial, { env = process.env } = {}) {
  const existing = loadDeepSeekConfigFile({ env }) ?? {}
  return {
    ...existing,
    ...partial,
  }
}

export function hasDeepSeekConfigFile({ env = process.env } = {}) {
  return existsSync(resolveDeepSeekConfigPath({ env }))
}

/**
 * Delete the DeepSeek config file if present. No-op when the file does not
 * exist. Errors during unlink propagate (caller decides whether to swallow).
 */
export function deleteDeepSeekConfigFile({ env = process.env } = {}) {
  const path = resolveDeepSeekConfigPath({ env })
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

export function loadProviderConfigFile({ env = process.env } = {}) {
  const path = resolveDeepSeekConfigPath({ env })
  if (!existsSync(path)) return createEmptyProviderConfig()
  enforceSecureMode(path, SECURE_FILE_MODE)
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createEmptyProviderConfig()
    }
    return normalizeProviderConfig(parsed)
  } catch {
    return createEmptyProviderConfig()
  }
}

export function saveProviderConfigFile(config, { env = process.env } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Provider config must be a plain object')
  }
  const path = resolveDeepSeekConfigPath({ env })
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE })
  } else {
    // An existing ~/.deepcode created before this hardening (or by another tool)
    // may be group/world-accessible; tighten it to 0o700 too.
    enforceSecureMode(dir, SECURE_DIR_MODE)
  }
  const persisted = normalizeProviderConfig(config)
  persisted.completedAt = new Date().toISOString()
  writeConfigAtomically(path, persisted)
  return path
}

export function mergeProviderConfigPartial(
  provider,
  partial,
  { env = process.env } = {},
) {
  if (!provider || typeof provider !== 'string') {
    throw new TypeError('Provider name must be a string')
  }
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('Provider config partial must be a plain object')
  }
  const existing = loadProviderConfigFile({ env })
  const next = {
    ...existing,
    activeProvider: provider,
    providers: {
      ...existing.providers,
      [provider]: {
        ...(existing.providers?.[provider] ?? {}),
        ...sanitizeProviderConfigSection(partial),
      },
    },
  }
  saveProviderConfigFile(next, { env })
  return next
}

function writeConfigAtomically(path, value) {
  const tmpPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    try {
      chmodSync(tmpPath, 0o600)
    } catch {}
    renameSync(tmpPath, path)
  } catch (error) {
    try {
      unlinkSync(tmpPath)
    } catch {}
    throw error
  }
}

function createEmptyProviderConfig() {
  return {
    activeProvider: undefined,
    providers: {},
  }
}

function normalizeProviderConfig(config) {
  if (config.providers && typeof config.providers === 'object') {
    const providers = {}
    for (const [provider, value] of Object.entries(config.providers)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      providers[provider] = sanitizeProviderConfigSection(value)
    }
    return {
      // Preserve forward-compatible TOP-LEVEL keys (e.g. a global default a
      // newer version added) so an older binary's load→save round-trip does
      // not strip them. `activeProvider`/`providers` are overwritten in place.
      ...config,
      activeProvider:
        typeof config.activeProvider === 'string'
          ? config.activeProvider
          : undefined,
      providers,
    }
  }

  return {
    activeProvider: 'deepseek',
    providers: {
      deepseek: sanitizeProviderConfigSection(config),
    },
  }
}

function extractDeepSeekConfig(config) {
  if (config.providers && typeof config.providers === 'object') {
    const deepseek = config.providers.deepseek
    if (!deepseek || typeof deepseek !== 'object' || Array.isArray(deepseek)) {
      return null
    }
    return sanitizeProviderConfigSection(deepseek)
  }
  return config
}

function sanitizeProviderConfigSection(config) {
  const sanitized = {
    // Spread the raw section FIRST so forward-compatible unknown keys (written
    // by a newer DeepCode version, in THIS or any sibling provider section)
    // survive a downgrade load→save round-trip rather than being silently
    // stripped. Spread copies an own `__proto__` data key as plain data (no
    // prototype setter); the validated known fields below overwrite in place.
    ...config,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : undefined,
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : undefined,
    model: typeof config.model === 'string' ? config.model : undefined,
    smallModel:
      typeof config.smallModel === 'string' ? config.smallModel : undefined,
    reasoningEffort:
      typeof config.reasoningEffort === 'string'
        ? config.reasoningEffort
        : undefined,
    thinking:
      typeof config.thinking === 'string' ? config.thinking : undefined,
    reasoningReplay:
      typeof config.reasoningReplay === 'boolean'
        ? config.reasoningReplay
        : undefined,
    models: normalizeCatalogModels(config.models),
  }
  for (const key of Object.keys(sanitized)) {
    if (sanitized[key] === undefined) delete sanitized[key]
  }
  return sanitized
}

// Validate the config `models` array into a clean catalog list, omitting the
// key entirely when there is nothing usable (so it never persists as `[]`).
function normalizeCatalogModels(value) {
  const models = sanitizeModelCatalogEntries(value)
  return models.length > 0 ? models : undefined
}

/**
 * Load the persisted DeepSeek config and merge its `models` with the built-in
 * model catalog. Returns the ordered, deduplicated catalog the model picker
 * renders. Reads disk; the pure merge lives in model-catalog.mjs.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Array<{ id: string, label?: string, description?: string }>}
 */
export function getResolvedDeepSeekModelCatalog({ env = process.env } = {}) {
  const fileConfig = loadDeepSeekConfigFile({ env })
  return getDeepSeekModelCatalog({ fileConfig })
}
