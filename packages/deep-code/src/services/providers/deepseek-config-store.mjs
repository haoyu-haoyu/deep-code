import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const CONFIG_FILENAME = 'deepseek-config.json'

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
    mkdirSync(dir, { recursive: true })
  }
  const persisted = {
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
    mkdirSync(dir, { recursive: true })
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
  }
  for (const key of Object.keys(sanitized)) {
    if (sanitized[key] === undefined) delete sanitized[key]
  }
  return sanitized
}
