const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const WHITE = '\x1b[38;2;232;236;255m'
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
  const apiKeyText = report.apiKeyConfigured ? 'API key configured' : 'API key missing'
  const title = ` Deep Code v${version} `
  const lines = [
    topBorder(title, width, color),
    row(
      c(`Welcome back ${userLabel}!`, 'blueLightBold', color),
      c('Tips for getting started', 'blueLightBold', color),
      leftWidth,
      rightWidth,
      color,
    ),
    row('', 'Run /init to create DEEPCODE.md', leftWidth, rightWidth, color),
    row('', '─'.repeat(Math.min(rightWidth, 36)), leftWidth, rightWidth, color),
    row(center('DeepSeek native', leftWidth), c('Recent activity', 'blueLightBold', color), leftWidth, rightWidth, color),
    row(center(model, leftWidth), cacheText, leftWidth, rightWidth, color),
    row(center(`${contextLabel} · reasoning ${effort}`, leftWidth), apiKeyText, leftWidth, rightWidth, color),
    row('', `Harness mode: ${harnessMode}`, leftWidth, rightWidth, color),
    row('', `Small model: ${smallModel}`, leftWidth, rightWidth, color),
    row(pathLabel, '', leftWidth, rightWidth, color),
    bottomBorder(width, color),
    '',
    `${c('›', 'blueLightBold', color)} ${c('Try "how does <filepath> work?"', 'blueLightBold', color)}`,
    '',
    `${c(workspaceLabel, 'blueLight', color)}  ${c(`${model} (${contextLabel})`, 'white', color)}  ${c('•', 'muted', color)} ${c(`${effort} · /effort`, 'muted', color)}`,
    '',
  ]
  return lines.join('\n')
}

export function formatDeepCodePrompt({
  color = process.stdout.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
} = {}) {
  return `${c('›', 'blueLightBold', color)} `
}

export function formatDeepCodeAssistantChunk(
  text,
  {
    color = process.stdout.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
  } = {},
) {
  return c(text, 'white', color)
}

export function formatDeepCodeInfoPanel(
  title,
  rows,
  {
    columns = process.stdout.columns,
    color = process.stdout.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
  } = {},
) {
  const width = clamp(Number(columns) || 80, 54, 88)
  const normalizedRows = rows.map(row => normalizePanelRow(row))
  const labelWidth = Math.min(
    22,
    Math.max(10, ...normalizedRows.map(row => stripAnsi(row.label).length)),
  )
  const valueWidth = Math.max(10, width - labelWidth - 7)
  return [
    topBorder(` ${title} `, width, color),
    ...normalizedRows.map(row => panelRow(row, labelWidth, valueWidth, color)),
    bottomBorder(width, color),
  ].join('\n')
}

export function formatDeepCodeTextPanel(
  title,
  text,
  {
    columns = process.stdout.columns,
    color = process.stdout.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
  } = {},
) {
  const rows = String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf(':')
      if (separator > 0 && separator <= 32) {
        return {
          label: line.slice(0, separator),
          value: line.slice(separator + 1).trim(),
        }
      }
      return line
    })
  return formatDeepCodeInfoPanel(title, rows, { columns, color })
}

export function formatDeepCodeCacheUsage(
  usage,
  {
    color = process.stderr.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
  } = {},
) {
  if (!usage) return ''
  const hitRate = Number(usage.hitRate ?? 0)
  const hit = usage.hit ?? 0
  const miss = usage.miss ?? 0
  return `${c('•', 'muted', color)} ${c(`DeepSeek cache hit ${hit} · miss ${miss} · ${(hitRate * 100).toFixed(1)}%`, 'muted', color)}`
}

export function formatDeepCodeSlashPalette(
  commands,
  {
    selectedIndex = 0,
    columns = process.stdout.columns,
    color = process.stdout.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
  } = {},
) {
  const width = clamp(Number(columns) || 80, 54, 96)
  const commandWidth = Math.max(12, ...commands.map(command => command.name.length))
  const descriptionWidth = Math.max(18, width - commandWidth - 7)
  const rule = c('─'.repeat(width), 'blue', color)
  return [
    rule,
    c('Slash commands', 'blueLightBold', color),
    ...commands.map((command, index) => {
      const marker = index === selectedIndex ? c('›', 'blueLightBold', color) : ' '
      return [
        marker,
        ' ',
        padVisible(c(command.name, index === selectedIndex ? 'whiteBold' : 'white', color), commandWidth),
        '  ',
        padVisible(c(command.description, index === selectedIndex ? 'white' : 'muted', color), descriptionWidth),
      ].join('')
    }),
    c('↑/↓ select · Enter confirm · Esc clear', 'muted', color),
    rule,
  ].join('\n')
}

export function formatDeepCodeModelPicker(
  {
    modelOptions,
    selectedIndex = 0,
    currentModel,
    effort,
  },
  {
    columns = process.stdout.columns,
    color = process.stdout.isTTY || process.env.DEEPCODE_FORCE_COLOR === '1',
  } = {},
) {
  const width = clamp(Number(columns) || 88, 70, 112)
  const title = ' Select model '
  const optionRows = modelOptions.map((option, index) => {
    const selected = index === selectedIndex
    const active = option.model === currentModel
    const marker = selected ? c('›', 'blueLightBold', color) : ' '
    const check = active ? c('✓', 'blueLightBold', color) : ' '
    const label = `${index + 1}. ${option.label}${active ? ' ' : ''}${stripAnsi(check)}`
    return `${marker} ${padVisible(c(label, selected ? 'whiteBold' : 'white', color), 28)} ${padVisible(c(option.model, selected ? 'blueLightBold' : 'white', color), 22)} ${c(option.description, selected ? 'white' : 'muted', color)}`
  })
  const rows = [
    c('Select model', 'blueLightBold', color),
    c('Switch the DeepSeek model for this session. Use --model for one-off commands.', 'muted', color),
    '',
    ...optionRows,
    '',
    `${c('•', 'blueLightBold', color)} ${c(`${effort} effort`, 'white', color)} ${c('←/→ adjust reasoning effort', 'muted', color)}`,
    '',
    c('Enter to confirm · Esc to exit', 'muted', color),
  ]
  return [
    topBorder(title, width, color),
    ...rows.map(line => `${c('│', 'blue', color)} ${padVisible(line, width - 4)} ${c('│', 'blue', color)}`),
    bottomBorder(width, color),
  ].join('\n')
}

function row(left, right, leftWidth, rightWidth, color) {
  return [
    c('│', 'blue', color),
    ` ${padVisible(left, leftWidth)} `,
    c('│', 'blue', color),
    ` ${padVisible(right, rightWidth)} `,
    c('│', 'blue', color),
  ].join('')
}

function panelRow(row, labelWidth, valueWidth, color) {
  if (row.fullWidth) {
    return `${c('│', 'blue', color)} ${padVisible(c(row.value, row.style, color), labelWidth + valueWidth + 3)} ${c('│', 'blue', color)}`
  }
  return [
    c('│', 'blue', color),
    ' ',
    padVisible(c(row.label, 'blueLightBold', color), labelWidth),
    ' ',
    padVisible(c(row.value, row.style, color), valueWidth),
    ' ',
    c('│', 'blue', color),
  ].join('')
}

function normalizePanelRow(row) {
  if (typeof row === 'string') {
    return {
      fullWidth: true,
      label: '',
      value: row,
      style: 'white',
    }
  }
  return {
    fullWidth: false,
    label: String(row.label ?? ''),
    value: String(row.value ?? ''),
    style: row.style ?? 'white',
  }
}

function topBorder(title, width, color) {
  const label = title.trim() ? `─${title}` : '─'
  const rest = '─'.repeat(Math.max(0, width - stripAnsi(label).length - 2))
  return c(`╭${label}${rest}╮`, 'blue', color)
}

function bottomBorder(width, color) {
  return c(`╰${'─'.repeat(width - 2)}╯`, 'blue', color)
}

function center(value, width) {
  const text = String(value ?? '')
  const visible = stripAnsi(text)
  if (visible.length >= width) return text
  const left = Math.floor((width - visible.length) / 2)
  return `${' '.repeat(left)}${text}`
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
  return `Cache hit ${hit}, miss ${miss}, rate ${rate}`
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
    white: WHITE,
    whiteBold: `${BOLD}${WHITE}`,
    muted: MUTED,
    dim: DIM,
  }[style]
  return prefix ? `${prefix}${text}${RESET}` : text
}
