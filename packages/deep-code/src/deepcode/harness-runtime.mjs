import { resolveDeepCodeHarnessConfig } from './harness-config.mjs'

let lastHarnessRuntimeDecision = null

export function resolveDeepCodeHarnessRuntime({
  env = process.env,
  prompt = '',
  isMainAgent = true,
  permissionMode = 'default',
  isSlashCommand,
  isLocalCommand = false,
} = {}) {
  const config = resolveDeepCodeHarnessConfig(env)
  const promptText = normalizePromptText(prompt)
  const slashCommand =
    isSlashCommand ?? promptText.trimStart().startsWith('/')

  if (!isMainAgent) {
    return inactiveDecision(config, 'subagent-nesting-disabled')
  }
  if (isLocalCommand || slashCommand) {
    return inactiveDecision(config, 'local-command')
  }
  if (config.mode === 'off') {
    return inactiveDecision(config, 'mode-off')
  }
  if (config.mode === 'swarm') {
    return activeDecision(config, 'swarm', 'mode-swarm', ['explicit-swarm'])
  }
  if (config.mode === 'on') {
    return activeDecision(config, 'harness', 'mode-on', ['explicit-on'])
  }

  const classification = classifyHarnessSignals(promptText, permissionMode)
  if (!classification.active) {
    return inactiveDecision(config, 'auto-simple-task')
  }
  return activeDecision(
    config,
    'harness',
    'auto-complex-task',
    classification.reasons,
  )
}

export function buildDeepCodeHarnessRuntimeContext(decision) {
  if (!decision?.active) return undefined

  const modeLabel = decision.state === 'swarm' ? 'swarm' : 'harness'
  return [
    `Deep Code Harness runtime is active for this turn.`,
    `Runtime mode: ${modeLabel}.`,
    `Runtime reason: ${decision.reason}.`,
    `Runtime signals: ${decision.reasons.join(', ') || 'explicit'}.`,
    `Max agents: ${decision.maxAgents}.`,
    `Recommended default Agent profile: ${decision.recommendedProfile}.`,
    `Delegation policy: ${decision.delegationPolicy}.`,
    `Available profiles: explorer, worker, verification, summarizer.`,
    `Use the Agent tool only for independent, material subtasks. Prefer explorer for read-only research, worker for focused implementation with write ownership, verification for independent checks, and summarizer for compact result condensation.`,
    `Do not delegate trivial file reads or commands. Keep tool-call continuations coherent and preserve DeepSeek reasoning continuity across tool results.`,
  ].join('\n')
}

export function formatDeepCodeHarnessRuntimeDecision(decision) {
  return [
    `Harness runtime: ${decision.state}`,
    `Runtime reason: ${decision.reason}`,
    `Runtime max agents: ${decision.maxAgents}`,
    `Runtime recommended profile: ${decision.recommendedProfile}`,
    `Runtime delegation policy: ${decision.delegationPolicy}`,
    `Runtime signals: ${decision.reasons.join(', ') || 'none'}`,
  ].join('\n')
}

export function resolveDeepCodeDefaultSubagentType({
  env = process.env,
  prompt = '',
  isMainAgent = true,
  permissionMode = 'default',
  runtimeDecision,
} = {}) {
  if (!isMainAgent) {
    return 'general-purpose'
  }
  if (runtimeDecision?.active) {
    return 'worker'
  }

  const decision = resolveDeepCodeHarnessRuntime({
    env,
    prompt,
    isMainAgent,
    permissionMode,
  })
  return decision.active ? 'worker' : 'general-purpose'
}

export function recordDeepCodeHarnessRuntimeDecision(decision) {
  lastHarnessRuntimeDecision = decision
}

export function getLastDeepCodeHarnessRuntimeDecision() {
  return lastHarnessRuntimeDecision
}

function inactiveDecision(config, reason) {
  return {
    active: false,
    state: 'inactive',
    mode: config.mode,
    reason,
    reasons: [],
    maxAgents: config.maxAgents,
    promptPack: config.promptPack,
    recommendedProfile: 'general-purpose',
    delegationPolicy: 'single-agent',
  }
}

function activeDecision(config, state, reason, reasons) {
  const delegationPolicy =
    state === 'swarm' ? 'team-lanes' : 'selective-specialists'
  return {
    active: true,
    state,
    mode: config.mode,
    reason,
    reasons,
    maxAgents: config.maxAgents,
    promptPack: config.promptPack,
    recommendedProfile: 'worker',
    delegationPolicy,
  }
}

function normalizePromptText(prompt) {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return String(prompt ?? '')
  return prompt
    .map(part => {
      if (typeof part === 'string') return part
      if (part?.type === 'text') return part.text ?? ''
      return ''
    })
    .join('\n')
}

function classifyHarnessSignals(prompt, permissionMode) {
  const text = prompt.toLowerCase()
  const reasons = new Set()
  const strongReasons = new Set()

  const hasTestSignal =
    /\b(test|tests|verify|verification|e2e|smoke)\b/.test(text) ||
    /测试|验证/.test(prompt)
  const hasFailureSignal =
    /\b(failing|failure|regression|broken|fix)\b/.test(text) ||
    /失败|修复|回归/.test(prompt)
  if (hasTestSignal || hasFailureSignal) {
    reasons.add('tests')
  }
  if (hasTestSignal && hasFailureSignal) {
    reasons.add('fix-failing-tests')
    strongReasons.add('fix-failing-tests')
  }
  if (/\b(agents?|subagents?|swarm|orchestrator|harness)\b/.test(text) || /子代理|蜂群|调度/.test(prompt)) {
    reasons.add('agent-orchestration')
    strongReasons.add('agent-orchestration')
  }
  if (/\b(cli|tui|tool|tools|permission|cache|provider|stream|sse|agent|subagent|swarm|orchestrator|harness)\b/.test(text) || /工具|权限|缓存|子代理|蜂群|调度/.test(prompt)) {
    reasons.add('tooling')
  }
  if (/\b(across|multi[- ]?file|multi[- ]?module|cross[- ]?module|full cli|full tui|registry|runtime)\b/.test(text) || /跨模块|多文件|完整/.test(prompt)) {
    reasons.add('cross-module')
    if (/\b(across|multi[- ]?file|multi[- ]?module|cross[- ]?module)\b/.test(text) || /跨模块|多文件/.test(prompt)) {
      strongReasons.add('cross-module')
    }
  }
  if (/\b(implement|refactor|migration|migrate|hardening|orchestrator|runtime)\b/.test(text) || /实现|重构|迁移|加固/.test(prompt)) {
    reasons.add('implementation')
  }
  if (permissionMode === 'bypassPermissions' || permissionMode === 'auto') {
    reasons.add(`permission-${permissionMode}`)
  }
  if (prompt.length > 220 && reasons.size > 0) {
    reasons.add('large-prompt')
  }

  const active = strongReasons.size > 0 || reasons.size >= 2
  return {
    active,
    reasons: active ? Array.from(reasons).sort() : [],
  }
}
