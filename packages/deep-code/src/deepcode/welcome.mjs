const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const BLUE = '\x1b[38;2;77;107;254m'
const BLUE_LIGHT = '\x1b[38;2;121;150;255m'
const MUTED = '\x1b[38;2;150;160;180m'

export function formatDeepCodeWelcome({
  version = '0.1.0-deepseek-native',
  report = {},
  cwd = process.cwd(),
  env = process.env,
  columns = process.stdout.columns,
  color = process.stdout.isTTY || env.DEEPCODE_FORCE_COLOR === '1',
} = {}) {
  const width = clamp(Number(columns) || 100, 82, 120)
  const innerWidth = width - 4
  const leftWidth = Math.floor((innerWidth - 3) * 0.56)
  const rightWidth = innerWidth - leftWidth - 3
  const model = report.config?.model ?? env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'
  const smallModel = report.config?.smallModel ?? env.DEEPSEEK_SMALL_MODEL ?? 'deepseek-v4-flash'
  const contextLabel = createContextLabel(report.contextPolicy)
  const effort = report.config?.reasoningEffort ?? env.DEEPSEEK_REASONING_EFFORT ?? 'max'
  const harnessMode = report.harnessConfig?.mode ?? env.DEEPCODE_HARNESS_MODE ?? 'auto'
  const pathLabel = abbreviateHome(cwd, env)
  const workspaceLabel = basename(cwd)
  const userLabel = displayUser(env)
  const cacheText = createCacheText(report.cacheStats)
  const apiKeyText = report.apiKeyConfigured ? 'DeepSeek API key configured' : 'DeepSeek API key missing'
  const title = ` Deep Code v${version} `
  const horizontal = '-'.repeat(Math.max(0, width - title.length - 2))
  const lines = [
    c(`+--${title}${horizontal}+`, 'blue', color),
    row(
      c(`Welcome back ${userLabel}!`, 'blueLightBold', color),
      c('Tips for getting started', 'blueLightBold', color),
      leftWidth,
      rightWidth,
      color,
    ),
    row('', 'Run /init to create a DEEPCODE.md file.', leftWidth, rightWidth, color),
    row('        ____', ''.padEnd(rightWidth, '-'), leftWidth, rightWidth, color),
    row('   ____/ __ \\____', c('Recent activity', 'blueLightBold', color), leftWidth, rightWidth, color),
    row('  / __  /_/ / __ \\', cacheText, leftWidth, rightWidth, color),
    row(' / /_/ / __/ /_/ /', apiKeyText, leftWidth, rightWidth, color),
    row(' \\__,_/_/  \\____/', `Harness mode: ${harnessMode}`, leftWidth, rightWidth, color),
    row('', `Small model: ${smallModel}`, leftWidth, rightWidth, color),
    row(`${model} (${contextLabel}) with reasoning ${effort}`, '', leftWidth, rightWidth, color),
    row(pathLabel, '', leftWidth, rightWidth, color),
    c(`+${'-'.repeat(width - 2)}+`, 'blue', color),
    '',
    c(`> Try "how does <filepath> work?"`, 'blueLightBold', color),
    '',
    `${c(workspaceLabel, 'blueLight', color)}  ${model} (${contextLabel})  ${c('*', 'muted', color)} ${effort} - /effort`,
    '',
  ]
  return lines.join('\n')
}

function row(left, right, leftWidth, rightWidth, color) {
  return [
    c('|', 'blue', color),
    ` ${padVisible(left, leftWidth)} `,
    c('|', 'blue', color),
    ` ${padVisible(right, rightWidth)} `,
    c('|', 'blue', color),
  ].join('')
}

function createContextLabel(policy = {}) {
  if (policy.supportsOneMillionContext || policy.contextWindowTokens >= 1_000_000) {
    return '1M context'
  }
  if (policy.contextWindowTokens) {
    return `${Math.round(policy.contextWindowTokens / 1000)}K context`
  }
  return '1M context'
}

function createCacheText(stats) {
  if (!stats) return 'No recent activity'
  const rate = percent(stats.lastPromptCacheHitRate)
  const hit = stats.lastPromptCacheHitTokens ?? 0
  const miss = stats.lastPromptCacheMissTokens ?? 0
  return `Cache last hit ${hit}, miss ${miss}, rate ${rate}`
}

function displayUser(env = {}) {
  const raw = env.DEEPCODE_DISPLAY_NAME ?? env.USER ?? env.LOGNAME ?? 'developer'
  const first = String(raw).split('@')[0].split(/[._-]/)[0]
  return first || 'developer'
}

function basename(path) {
  const parts = String(path ?? '').split('/').filter(Boolean)
  return parts.at(-1) ?? '.'
}

function abbreviateHome(path, env = {}) {
  const home = env.HOME
  const text = String(path ?? '')
  return home && text.startsWith(home) ? `~${text.slice(home.length)}` : text
}

function padVisible(value, width) {
  const text = stripAnsi(String(value ?? ''))
  const truncated = text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text
  const original = String(value ?? '')
  const visible = stripAnsi(original)
  const content = visible.length > width ? truncated : original
  const contentLength = stripAnsi(content).length
  return `${content}${' '.repeat(Math.max(0, width - contentLength))}`
}

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '')
}

function percent(value) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function c(text, style, enabled) {
  if (!enabled) return text
  const prefix = {
    blue: BLUE,
    blueLight: BLUE_LIGHT,
    blueLightBold: `${BOLD}${BLUE_LIGHT}`,
    muted: MUTED,
    dim: DIM,
  }[style]
  return prefix ? `${prefix}${text}${RESET}` : text
}
