const HARNESS_MODES = new Set(['auto', 'off', 'on', 'swarm'])
const STRICT_TOOL_MODES = new Set(['off', 'safe', 'all', 'nullable'])

export function resolveDeepCodeHarnessConfig(env = process.env) {
  return {
    mode: normalizeChoice(env.DEEPCODE_HARNESS_MODE, HARNESS_MODES, 'auto'),
    maxAgents: normalizeMaxAgents(env.DEEPCODE_HARNESS_MAX_AGENTS),
    defaultSmallModel:
      env.DEEPCODE_HARNESS_DEFAULT_SMALL_MODEL ||
      env.DEEPSEEK_SMALL_MODEL ||
      'deepseek-v4-flash',
    coordinatorModel:
      env.DEEPCODE_HARNESS_COORDINATOR_MODEL ||
      env.DEEPSEEK_MODEL ||
      'deepseek-v4-pro',
    verifierModel:
      env.DEEPCODE_HARNESS_VERIFIER_MODEL ||
      env.DEEPSEEK_MODEL ||
      'deepseek-v4-pro',
    promptPack: env.DEEPCODE_PROMPT_PACK || 'deepseek-v1',
    strictTools: normalizeChoice(
      env.DEEPCODE_STRICT_TOOLS,
      STRICT_TOOL_MODES,
      'off',
    ),
  }
}

export function formatDeepCodeHarnessStatus(config) {
  return [
    `Harness mode: ${config.mode}`,
    `Harness max agents: ${config.maxAgents}`,
    `Prompt pack: ${config.promptPack}`,
    `Strict tools: ${config.strictTools}`,
    `Harness small model: ${config.defaultSmallModel}`,
    `Harness coordinator model: ${config.coordinatorModel}`,
    `Harness verifier model: ${config.verifierModel}`,
  ].join('\n')
}

function normalizeChoice(value, allowed, fallback) {
  if (!value) return fallback
  const normalized = String(value).trim().toLowerCase()
  return allowed.has(normalized) ? normalized : fallback
}

function normalizeMaxAgents(value) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return 4
  return Math.min(Math.max(parsed, 1), 8)
}
