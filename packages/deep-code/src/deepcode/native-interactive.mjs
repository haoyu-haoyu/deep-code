import readline from 'node:readline/promises'
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
    const previousLines = previousBlock ? previousBlock.split('\n').length : 0
    if (previousLines > 0) this.output.write(`\x1b[${previousLines}B`)
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
    const previousLines = previousBlock ? previousBlock.split('\n').length : 0
    if (previousLines > 0) this.output.write(`\x1b[${previousLines}B`)
    this.output.write('\r\x1b[J')
    this.output.write(block)
    this.output.write(`\x1b[${block.split('\n').length - 1}A`)
    this.output.write('\r')
  }

  finishRender(block) {
    if (this.output.isTTY && block) {
      this.output.write(`\x1b[${block.split('\n').length}B\r\x1b[J`)
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
  return Boolean(output.isTTY) || env.DEEPCODE_FORCE_COLOR === '1'
}

function wrap(index, length) {
  return ((index % length) + length) % length
}

function visibleLength(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '').length
}
