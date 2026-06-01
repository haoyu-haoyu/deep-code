// Shared key/env resolution for the live DeepSeek E2E probe scripts
// (deepseek-cache-e2e, deepseek-reasoning-cost-probe, deepseek-toolchain-e2e,
// deepseek-acp-e2e). Loads ~/.deepcode/settings.json (honoring
// DEEPCODE_CONFIG_DIR) and merges its `env` block UNDER the real process env,
// so a key configured only in settings.json works exactly like one exported in
// the shell — matching how the CLI itself resolves config. This is why a probe
// may advertise "DEEPSEEK_API_KEY (or ~/.deepcode/settings.json env)" as the
// source: both paths resolve here.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function firstConfigured(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0)
}

export async function loadDeepCodeSettings(env = process.env) {
  const configDir = env.DEEPCODE_CONFIG_DIR || join(homedir(), '.deepcode')
  const settingsPath = join(configDir, 'settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(await readFile(settingsPath, 'utf8'))
  } catch {
    return {}
  }
}

export function mergeSettingsEnv(env, settings) {
  const settingsEnv = settings.env ?? {}
  return {
    ...env,
    DEEPSEEK_API_KEY: firstConfigured(
      env.DEEPSEEK_API_KEY,
      env.DEEPCODE_API_KEY,
      settingsEnv.DEEPSEEK_API_KEY,
      settingsEnv.DEEPCODE_API_KEY,
      settingsEnv.API_KEY,
    ),
    DEEPSEEK_BASE_URL: firstConfigured(
      env.DEEPSEEK_BASE_URL,
      env.DEEPCODE_BASE_URL,
      settingsEnv.DEEPSEEK_BASE_URL,
      settingsEnv.DEEPCODE_BASE_URL,
      settingsEnv.BASE_URL,
    ),
    DEEPSEEK_MODEL: firstConfigured(
      env.DEEPSEEK_MODEL,
      env.DEEPCODE_MODEL,
      settingsEnv.DEEPSEEK_MODEL,
      settingsEnv.DEEPCODE_MODEL,
      settingsEnv.MODEL,
    ),
    DEEPSEEK_SMALL_MODEL: firstConfigured(
      env.DEEPSEEK_SMALL_MODEL,
      env.DEEPCODE_SMALL_MODEL,
      settingsEnv.DEEPSEEK_SMALL_MODEL,
      settingsEnv.DEEPCODE_SMALL_MODEL,
      settingsEnv.SMALL_MODEL,
    ),
  }
}

// process.env merged with settings.json env — the `env` to hand to providers /
// agents in the probe scripts.
export async function resolveLiveE2EEnv(baseEnv = process.env) {
  return mergeSettingsEnv(baseEnv, await loadDeepCodeSettings(baseEnv))
}
