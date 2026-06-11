import readline from 'node:readline/promises'
import { shouldUseColor } from './colorSupport.mjs'
import {
  formatDeepCodeModelPicker,
  formatDeepCodePrompt,
  formatDeepCodeSlashPalette,
} from './welcome.mjs'

export const DEEP_CODE_SLASH_COMMANDS = [
  {
    name: '/model',
    description: 'Select model and reasoning effort',
  },
  {
    name: '/status',
    description: 'Show Deep Code status',
  },
  {
    name: '/doctor',
    description: 'Run DeepSeek native diagnostics',
  },
  {
    name: '/harness',
    description: 'Show Harness mode and agent settings',
  },
  {
    name: '/compact',
    description: 'Compact current conversation context',
  },
  {
    name: '/exit',
    description: 'Exit Deep Code',
  },
]

export const DEEP_CODE_MODEL_OPTIONS = [
  {
    label: 'Default (recommended)',
    model: 'deepseek-v4-pro',
    description: 'Most capable for complex code work',
  },
  {
    label: 'Flash',
    model: 'deepseek-v4-flash',
    description: 'Fast for short answers, summaries, and subagents',
  },
]

const DEEP_CODE_EFFORTS = ['high', 'max']
const DEEP_CODE_BLUE = '\x1b[38;2;77;107;254m'
const DEEP_CODE_BLUE_SHIMMER = '\x1b[38;2;121;150;255m'
const DEEP_CODE_MUTED = '\x1b[38;2;150;160;180m'
const DEEP_CODE_SUCCESS = '\x1b[38;2;82;196;126m'
const DEEP_CODE_ERROR = '\x1b[38;2;255;92;122m'
const DEEP_CODE_RESET = '\x1b[0m'
const DEEP_CODE_BLACK_CIRCLE = '●'
const DEEP_CODE_SPINNER_BASE_FRAMES = getSpinnerBaseFrames()
const DEEP_CODE_SPINNER_FRAMES = [
  ...DEEP_CODE_SPINNER_BASE_FRAMES,
  ...[...DEEP_CODE_SPINNER_BASE_FRAMES].reverse(),
]

export function shouldForceNativeInteractive(env = process.env) {
  return (
    env.DEEPCODE_FORCE_NATIVE_INTERACTIVE === '1' ||
    env.DEEPCODE_FORCE_NATIVE_INTERACTIVE_KEYS === '1'
  )
}

export function shouldUseKeyDrivenInteractive(
  input = process.stdin,
  env = process.env,
) {
  return Boolean(input.isTTY) || env.DEEPCODE_FORCE_NATIVE_INTERACTIVE_KEYS === '1'
}

export function createDeepCodeInteractiveReader({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
} = {}) {
  if (shouldUseKeyDrivenInteractive(input, env)) {
    return new KeyDrivenInteractiveReader({ input, output, env })
  }
  return new ReadlineInteractiveReader({ input, output })
}

export function createDeepCodeTurnSpinner({
  output = process.stdout,
  env = process.env,
  intervalMs = 50,
  message = 'DeepSeek reasoning',
  mode = 'thinking',
} = {}) {
  const enabled =
    Boolean(output.isTTY) ||
    env.DEEPCODE_FORCE_NATIVE_SPINNER === '1' ||
    env.DEEPCODE_FORCE_COLOR === '1'
  const color = shouldColor(output, env)
  let timer = null
  let frame = 0
  let startedAt = 0
  let active = false

  const render = () => {
    if (!enabled) return
    const timeMs = startedAt ? Date.now() - startedAt : 0
    output.write(`\r\x1b[J${formatDeepCodeSpinnerFrame({
      message,
      mode,
      timeMs,
      color,
    })}`)
    frame += 1
  }

  return {
    start() {
      if (!enabled || active) return
      active = true
      startedAt = Date.now()
      render()
      timer = setInterval(render, intervalMs)
      timer.unref?.()
    },
    stop({ clear = true } = {}) {
      if (!active) return
      active = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (enabled && clear) output.write('\r\x1b[J')
    },
    isActive() {
      return active
    },
  }
}

export function formatDeepCodeSpinnerFrame({
  message = 'DeepSeek reasoning',
  mode = 'thinking',
  timeMs = 0,
  color = false,
} = {}) {
  const frame = Math.floor(timeMs / 120)
  const glyph = DEEP_CODE_SPINNER_FRAMES[frame % DEEP_CODE_SPINNER_FRAMES.length]
  const shimmer =
    frame % DEEP_CODE_SPINNER_FRAMES.length < DEEP_CODE_SPINNER_BASE_FRAMES.length
  const glyphText = color
    ? `${shimmer ? DEEP_CODE_BLUE_SHIMMER : DEEP_CODE_BLUE}${glyph}${DEEP_CODE_RESET}`
    : glyph
  const messageText = formatDeepCodeGlimmerMessage({
    message,
    mode,
    timeMs,
    color,
  })
  const elapsedSeconds = Math.max(0, Math.floor(timeMs / 1000))
  const suffix = elapsedSeconds > 1
    ? color
      ? ` ${DEEP_CODE_MUTED}(${elapsedSeconds}s)${DEEP_CODE_RESET}`
      : ` (${elapsedSeconds}s)`
    : ''
  return `${glyphText} ${messageText}${suffix}`
}

export function formatDeepCodeToolUseLine({
  name,
  input = {},
  state = 'running',
  frame = 0,
  color = false,
} = {}) {
  const unresolved = state === 'running' || state === 'queued' || state === 'permission'
  const blinkOff = unresolved && state === 'running' && frame % 2 === 1
  const dot = blinkOff ? ' ' : DEEP_CODE_BLACK_CIRCLE
  const dotColor =
    !color ? '' : state === 'error' ? DEEP_CODE_ERROR : unresolved ? DEEP_CODE_MUTED : DEEP_CODE_SUCCESS
  const dotText = color ? `${dotColor}${dot}${DEEP_CODE_RESET}` : dot
  const toolName = color ? `${DEEP_CODE_BLUE_SHIMMER}${name}${DEEP_CODE_RESET}` : String(name ?? '')
  const summary = summarizeToolInput(name, input)
  const summaryText = summary
    ? color
      ? ` ${DEEP_CODE_MUTED}(${summary})${DEEP_CODE_RESET}`
      : ` (${summary})`
    : ''
  const waitingText = state === 'permission'
    ? color
      ? ` ${DEEP_CODE_MUTED}Waiting for permission…${DEEP_CODE_RESET}`
      : ' Waiting for permission…'
    : ''
  return `${dotText} ${toolName}${summaryText}${waitingText}`
}

class ReadlineInteractiveReader {
  supportsKeyMenus = false

  constructor({ input, output }) {
    this.rl = readline.createInterface({ input, output })
  }

  async readLine() {
    try {
      return await this.rl.question(formatDeepCodePrompt())
    } catch (error) {
      if (error?.message === 'readline was closed') return null
      throw error
    }
  }

  close() {
    this.rl.close()
  }
}

class KeyDrivenInteractiveReader {
  supportsKeyMenus = true

  constructor({ input, output, env }) {
    this.input = input
    this.output = output
    this.env = env
    this.tokens = []
    this.waiters = []
    this.ended = false
    this.rawModeEnabled = false
    this.dataHandler = chunk => this.pushTokens(parseKeyTokens(String(chunk)))
    this.endHandler = () => this.pushToken({ type: 'eof' })
    this.input.setEncoding?.('utf8')
    if (this.input.isTTY && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(true)
      this.rawModeEnabled = true
    }
    this.input.on('data', this.dataHandler)
    this.input.on('end', this.endHandler)
    this.input.resume?.()
  }

  async readLine() {
    let buffer = ''
    let selectedIndex = 0
    let renderedBlock = ''
    this.writePrompt(buffer)

    while (true) {
      const token = await this.readToken()
      if (!token || token.type === 'eof') {
        return buffer ? buffer : null
      }
      if (token.type === 'ctrl-c') {
        this.output.write('^C\n')
        return '/exit'
      }
      if (token.type === 'escape') {
        buffer = ''
        selectedIndex = 0
        renderedBlock = this.renderLine(buffer, selectedIndex, renderedBlock)
        continue
      }
      const matches = matchSlashCommands(buffer)
      if (token.type === 'up' && matches.length > 0) {
        selectedIndex = wrap(selectedIndex - 1, matches.length)
        renderedBlock = this.renderLine(buffer, selectedIndex, renderedBlock)
        continue
      }
      if (token.type === 'down' && matches.length > 0) {
        selectedIndex = wrap(selectedIndex + 1, matches.length)
        renderedBlock = this.renderLine(buffer, selectedIndex, renderedBlock)
        continue
      }
      if (token.type === 'tab' && matches[selectedIndex]) {
        buffer = matches[selectedIndex].name
        selectedIndex = 0
        renderedBlock = this.renderLine(buffer, selectedIndex, renderedBlock)
        continue
      }
      if (token.type === 'backspace') {
        buffer = buffer.slice(0, -1)
        selectedIndex = 0
        renderedBlock = this.renderLine(buffer, selectedIndex, renderedBlock)
        continue
      }
      if (token.type === 'enter') {
        const finalMatches = matchSlashCommands(buffer)
        const value =
          buffer.trim() === '/' && finalMatches[selectedIndex]
            ? finalMatches[selectedIndex].name
            : buffer
        this.finishRender(renderedBlock)
        return value
      }
      if (token.type === 'char') {
        buffer += token.value
        selectedIndex = 0
        renderedBlock = this.renderLine(buffer, selectedIndex, renderedBlock)
      }
    }
  }

  async selectModel({ config }) {
    let selectedIndex = Math.max(
      0,
      DEEP_CODE_MODEL_OPTIONS.findIndex(option => option.model === config.model),
    )
    let effortIndex = DEEP_CODE_EFFORTS.indexOf(config.reasoningEffort)
    if (effortIndex === -1) effortIndex = DEEP_CODE_EFFORTS.length - 1
    let renderedBlock = ''
    renderedBlock = this.renderModelPicker(selectedIndex, effortIndex, config, renderedBlock)

    while (true) {
      const token = await this.readToken()
      if (!token || token.type === 'eof') {
        this.finishRender(renderedBlock)
        return null
      }
      if (token.type === 'ctrl-c' || token.type === 'escape') {
        this.finishRender(renderedBlock)
        return null
      }
      if (token.type === 'up') {
        selectedIndex = wrap(selectedIndex - 1, DEEP_CODE_MODEL_OPTIONS.length)
        renderedBlock = this.renderModelPicker(selectedIndex, effortIndex, config, renderedBlock)
        continue
      }
      if (token.type === 'down') {
        selectedIndex = wrap(selectedIndex + 1, DEEP_CODE_MODEL_OPTIONS.length)
        renderedBlock = this.renderModelPicker(selectedIndex, effortIndex, config, renderedBlock)
        continue
      }
      if (token.type === 'left') {
        effortIndex = wrap(effortIndex - 1, DEEP_CODE_EFFORTS.length)
        renderedBlock = this.renderModelPicker(selectedIndex, effortIndex, config, renderedBlock)
        continue
      }
      if (token.type === 'right') {
        effortIndex = wrap(effortIndex + 1, DEEP_CODE_EFFORTS.length)
        renderedBlock = this.renderModelPicker(selectedIndex, effortIndex, config, renderedBlock)
        continue
      }
      if (token.type === 'enter') {
        this.finishRender(renderedBlock)
        return {
          model: DEEP_CODE_MODEL_OPTIONS[selectedIndex].model,
          reasoningEffort: DEEP_CODE_EFFORTS[effortIndex],
        }
      }
    }
  }

  close() {
    this.input.off('data', this.dataHandler)
    this.input.off('end', this.endHandler)
    if (this.rawModeEnabled) {
      this.input.setRawMode(false)
    }
    this.input.pause?.()
  }

  writePrompt(buffer) {
    this.output.write(`${formatDeepCodePrompt()}${buffer}`)
  }

  renderLine(buffer, selectedIndex, previousBlock) {
    const matches = matchSlashCommands(buffer)
    const block =
      matches.length > 0
        ? formatDeepCodeSlashPalette(matches, {
            selectedIndex: Math.min(selectedIndex, matches.length - 1),
            columns: this.output.columns,
            color: shouldColor(this.output, this.env),
          })
        : ''
    this.renderDynamicLine(buffer, block, previousBlock)
    return block
  }

  renderModelPicker(selectedIndex, effortIndex, config, previousBlock) {
    const block = formatDeepCodeModelPicker({
      modelOptions: DEEP_CODE_MODEL_OPTIONS,
      selectedIndex,
      currentModel: config.model,
      effort: DEEP_CODE_EFFORTS[effortIndex],
    }, {
      columns: this.output.columns,
      color: shouldColor(this.output, this.env),
    })
    this.renderDynamicBlock(block, previousBlock)
    return block
  }

  renderDynamicLine(buffer, block, previousBlock) {
    if (!this.output.isTTY) {
      if (block && block !== previousBlock) {
        this.output.write(`\n${block}\n`)
      }
      return
    }
    const prompt = formatDeepCodePrompt()
    this.output.write('\r\x1b[J')
    this.output.write(`${prompt}${buffer}`)
    if (block) {
      this.output.write(`\n${block}`)
      this.output.write(`\x1b[${block.split('\n').length}A`)
      this.output.write(`\r\x1b[${visibleLength(prompt + buffer) + 1}C`)
    }
  }

  renderDynamicBlock(block, previousBlock) {
    if (!this.output.isTTY) {
      if (block !== previousBlock) this.output.write(`${block}\n`)
      return
    }
    this.output.write('\r\x1b[J')
    this.output.write(block)
    this.output.write(`\x1b[${block.split('\n').length - 1}A`)
    this.output.write('\r')
  }

  finishRender(block) {
    if (this.output.isTTY && block) {
      this.output.write('\r\x1b[J')
    }
    this.output.write('\n')
  }

  async readToken() {
    if (this.tokens.length > 0) return this.tokens.shift()
    if (this.ended) return null
    return await new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }

  pushTokens(tokens) {
    for (const token of tokens) this.pushToken(token)
  }

  pushToken(token) {
    if (token.type === 'eof') this.ended = true
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(token)
      return
    }
    this.tokens.push(token)
  }
}

function matchSlashCommands(buffer) {
  if (!buffer.startsWith('/')) return []
  const query = buffer.trim()
  return DEEP_CODE_SLASH_COMMANDS.filter(command => command.name.startsWith(query))
}

function parseKeyTokens(chunk) {
  const tokens = []
  for (let index = 0; index < chunk.length; index++) {
    const char = chunk[index]
    const triple = chunk.slice(index, index + 3)
    if (triple === '\x1b[A') {
      tokens.push({ type: 'up' })
      index += 2
      continue
    }
    if (triple === '\x1b[B') {
      tokens.push({ type: 'down' })
      index += 2
      continue
    }
    if (triple === '\x1b[C') {
      tokens.push({ type: 'right' })
      index += 2
      continue
    }
    if (triple === '\x1b[D') {
      tokens.push({ type: 'left' })
      index += 2
      continue
    }
    if (char === '\x1b') {
      tokens.push({ type: 'escape' })
      continue
    }
    if (char === '\x03') {
      tokens.push({ type: 'ctrl-c' })
      continue
    }
    if (char === '\r' || char === '\n') {
      tokens.push({ type: 'enter' })
      if (char === '\r' && chunk[index + 1] === '\n') index += 1
      continue
    }
    if (char === '\x7f' || char === '\b') {
      tokens.push({ type: 'backspace' })
      continue
    }
    if (char === '\t') {
      tokens.push({ type: 'tab' })
      continue
    }
    tokens.push({ type: 'char', value: char })
  }
  return tokens
}

function shouldColor(output, env) {
  return shouldUseColor(output, env)
}

function formatDeepCodeGlimmerMessage({
  message,
  mode,
  timeMs,
  color,
}) {
  const text = String(message ?? '')
  if (!color || !text) return text

  if (mode === 'tool-use') {
    const flashOpacity = (Math.sin((timeMs / 1000) * Math.PI) + 1) / 2
    const colorCode = flashOpacity > 0.5 ? DEEP_CODE_BLUE_SHIMMER : DEEP_CODE_BLUE
    return `${colorCode}${text}${DEEP_CODE_RESET}`
  }

  const segments = Array.from(text)
  const messageWidth = segments.length
  const glimmerSpeed = mode === 'requesting' ? 50 : 200
  const cyclePosition = Math.floor(timeMs / glimmerSpeed)
  const cycleLength = messageWidth + 20
  const glimmerIndex =
    mode === 'requesting'
      ? (cyclePosition % cycleLength) - 10
      : messageWidth + 10 - (cyclePosition % cycleLength)
  const shimmerStart = glimmerIndex - 1
  const shimmerEnd = glimmerIndex + 1
  if (shimmerStart >= messageWidth || shimmerEnd < 0) {
    return `${DEEP_CODE_BLUE}${text}${DEEP_CODE_RESET}`
  }

  let before = ''
  let shimmer = ''
  let after = ''
  for (let index = 0; index < segments.length; index++) {
    if (index < shimmerStart) {
      before += segments[index]
    } else if (index > shimmerEnd) {
      after += segments[index]
    } else {
      shimmer += segments[index]
    }
  }

  return [
    before ? `${DEEP_CODE_BLUE}${before}${DEEP_CODE_RESET}` : '',
    shimmer ? `${DEEP_CODE_BLUE_SHIMMER}${shimmer}${DEEP_CODE_RESET}` : '',
    after ? `${DEEP_CODE_BLUE}${after}${DEEP_CODE_RESET}` : '',
  ].join('')
}

function summarizeToolInput(name, input) {
  const toolName = String(name ?? '')
  const data = input && typeof input === 'object' ? input : {}
  if (toolName === 'Read' && data.file_path) return String(data.file_path)
  if (toolName === 'Edit' && data.file_path) return String(data.file_path)
  if (toolName === 'Write' && data.file_path) return String(data.file_path)
  if (toolName === 'Bash' && data.command) return String(data.command)
  if (toolName === 'Agent' && data.subagent_type) return String(data.subagent_type)
  if (toolName === 'Agent' && data.description) return String(data.description)
  const firstStringEntry = Object.entries(data).find(([, value]) => typeof value === 'string')
  if (firstStringEntry) return firstStringEntry[1]
  return ''
}

function getSpinnerBaseFrames() {
  if (process.env.TERM === 'xterm-ghostty') return ['·', '✢', '✳', '✶', '✻', '*']
  if (process.platform === 'darwin') return ['·', '✢', '✳', '✶', '✻', '✽']
  return ['·', '✢', '*', '✶', '✻', '✽']
}

function wrap(index, length) {
  return ((index % length) + length) % length
}

function visibleLength(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '').length
}
