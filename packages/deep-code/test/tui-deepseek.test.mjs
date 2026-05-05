import { test, expect } from 'bun:test'

import {
  buildDeepSeekQueryDepsHarness,
  buildDeepSeekTuiQueryHarness,
} from './support/tui-query-harness.mjs'

test('TUI query harness imports the original query loop', async () => {
  const harness = await buildDeepSeekTuiQueryHarness()

  expect(typeof harness.query).toBe('function')
})

test('TUI query loop executes a DeepSeek-style tool turn and continues', async () => {
  const harness = await buildDeepSeekTuiQueryHarness()
  const modelRequests = []
  const toolCalls = []
  const toolResultMessage = {
    type: 'user',
    uuid: 'tool-result-message',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_deepseek_1',
          content: 'tool result from Deep Code',
        },
      ],
    },
  }

  globalThis.__deepcodeTuiHarness = {
    async *runTools(toolUseBlocks) {
      toolCalls.push(toolUseBlocks)
      yield { message: toolResultMessage }
    },
  }

  try {
    const terminal = await drain(
      harness.query({
        messages: [userMessage('inspect the repo')],
        systemPrompt: ['You are Deep Code.'],
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        querySource: 'sdk',
        maxTurns: 3,
        toolUseContext: createToolUseContext(),
        deps: createDeepSeekToolTurnDeps(modelRequests),
      }),
    )

    expect(terminal.reason).toBe('completed')
    expect(modelRequests).toHaveLength(2)
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0][0]).toMatchObject({
      id: 'toolu_deepseek_1',
      name: 'FakeTool',
      input: { path: 'package.json' },
    })
    expect(modelRequests[1].some(message => message.uuid === 'tool-result-message')).toBe(true)
  } finally {
    delete globalThis.__deepcodeTuiHarness
  }
})

test('production query deps default to DeepSeek native provider', async () => {
  const previousDeepCodeProvider = process.env.DEEPCODE_PROVIDER
  const previousDeepCodeProviderAlt = process.env.DEEP_CODE_PROVIDER
  delete process.env.DEEPCODE_PROVIDER
  delete process.env.DEEP_CODE_PROVIDER

  try {
    const harness = await buildDeepSeekQueryDepsHarness()
    const deps = harness.productionDeps()

    expect(deps.callModel.name).toBe('queryDeepSeekModelWithStreaming')
  } finally {
    restoreEnv('DEEPCODE_PROVIDER', previousDeepCodeProvider)
    restoreEnv('DEEP_CODE_PROVIDER', previousDeepCodeProviderAlt)
  }
})

async function drain(generator) {
  while (true) {
    const result = await generator.next()
    if (result.done) return result.value
  }
}

function userMessage(content) {
  return {
    type: 'user',
    uuid: 'user-message',
    message: { role: 'user', content },
  }
}

function createToolUseContext() {
  const abortController = new AbortController()
  return {
    abortController,
    readFileState: {},
    addNotification() {},
    getAppState() {
      return {
        toolPermissionContext: { mode: 'default' },
        fastMode: false,
        mcp: { tools: [], clients: [] },
        effortValue: 'max',
        advisorModel: undefined,
      }
    },
    options: {
      tools: [{ name: 'FakeTool' }],
      mainLoopModel: 'deepseek-v4-pro',
      thinkingConfig: { type: 'enabled' },
      isNonInteractiveSession: true,
      appendSystemPrompt: undefined,
      agentDefinitions: {
        activeAgents: {},
        allowedAgentTypes: [],
      },
    },
  }
}

function createDeepSeekToolTurnDeps(modelRequests) {
  let callCount = 0
  return {
    uuid: () => `deepcode-test-uuid-${callCount}`,
    async microcompact(messages) {
      return { messages }
    },
    async autocompact() {
      return { compactionResult: null, consecutiveFailures: undefined }
    },
    async *callModel({ messages }) {
      modelRequests.push(messages)
      callCount += 1
      if (callCount === 1) {
        yield assistantMessage('assistant-tool-call', [
          {
            type: 'tool_use',
            id: 'toolu_deepseek_1',
            name: 'FakeTool',
            input: { path: 'package.json' },
          },
        ])
        return
      }
      yield assistantMessage('assistant-final', [
        { type: 'text', text: 'Done with the DeepSeek-native tool turn.' },
      ])
    },
  }
}

function assistantMessage(uuid, content) {
  return {
    type: 'assistant',
    uuid,
    message: {
      role: 'assistant',
      model: 'deepseek-v4-pro',
      content,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
