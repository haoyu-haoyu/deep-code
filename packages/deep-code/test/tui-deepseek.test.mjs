import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  buildDeepSeekModelHarness,
  buildDeepSeekModelOptionsHarness,
  buildDeepSeekPrintModelInfoHarness,
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

test('TUI query loop carries a DeepSeek Harness Agent tool turn through continuation', async () => {
  const harness = await buildDeepSeekTuiQueryHarness()
  const previousMode = process.env.DEEPCODE_HARNESS_MODE
  const modelRequests = []
  const agentToolCalls = []
  const toolResultMessage = {
    type: 'user',
    uuid: 'tool-result-agent',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_agent_1',
          content: 'worker result: inspected cache and permissions',
        },
      ],
    },
  }

  process.env.DEEPCODE_HARNESS_MODE = 'on'
  globalThis.__deepcodeTuiHarness = {
    async *runTools(toolUseBlocks, assistantMessages, _canUseTool, toolUseContext) {
      agentToolCalls.push({
        toolUseBlocks,
        assistantContent: assistantMessages.flatMap(message => message.message.content),
        agentId: toolUseContext.agentId,
        permissionMode: toolUseContext.getAppState().toolPermissionContext.mode,
      })
      yield { message: toolResultMessage }
    },
  }

  try {
    const terminal = await drain(
      harness.query({
        messages: [userMessage('fix failing tests across the full CLI and TUI')],
        systemPrompt: ['You are Deep Code.'],
        userContext: {
          deepCodeHarnessRuntime:
            'Deep Code Harness runtime is active for this turn.',
        },
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        querySource: 'sdk',
        maxTurns: 3,
        toolUseContext: createToolUseContext({
          permissionMode: 'default',
          tools: [{ name: 'Agent' }],
        }),
        deps: createDeepSeekAgentToolDeps(modelRequests),
      }),
    )

    expect(terminal.reason).toBe('completed')
    expect(modelRequests).toHaveLength(2)
    expect(agentToolCalls).toHaveLength(1)
    expect(agentToolCalls[0].toolUseBlocks[0]).toMatchObject({
      id: 'toolu_agent_1',
      name: 'Agent',
      input: {
        description: 'Inspect cache',
        prompt: 'Inspect cache and permission behavior.',
      },
    })
    expect(agentToolCalls[0].toolUseBlocks[0].input.subagent_type).toBeUndefined()
    expect(agentToolCalls[0].agentId).toBeUndefined()
    expect(agentToolCalls[0].permissionMode).toBe('default')
    expect(agentToolCalls[0].assistantContent).toContainEqual({
      type: 'thinking',
      thinking: 'Use one worker and continue after the result.',
    })
    const followUpAssistant = modelRequests[1].find(
      message => message.uuid === 'assistant-agent-call',
    )
    expect(followUpAssistant.message.content).toContainEqual({
      type: 'thinking',
      thinking: 'Use one worker and continue after the result.',
    })
    expect(modelRequests[1].some(message => message.uuid === 'tool-result-agent')).toBe(true)
  } finally {
    restoreEnv('DEEPCODE_HARNESS_MODE', previousMode)
    delete globalThis.__deepcodeTuiHarness
  }
})

test('TUI query loop preserves DeepSeek reasoning across permission-gated tool turns', async () => {
  const harness = await buildDeepSeekTuiQueryHarness()
  const permissionModes = ['default', 'auto', 'bypassPermissions']

  for (const permissionMode of permissionModes) {
    const modelRequests = []
    const permissionSnapshots = []
    const toolExecutions = []
    const toolResultMessage = {
      type: 'user',
      uuid: `tool-result-${permissionMode}`,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `toolu_${permissionMode}_read`,
            content: `tool result in ${permissionMode}`,
          },
        ],
      },
    }

    globalThis.__deepcodeTuiHarness = {
      async *runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext) {
        toolExecutions.push({
          permissionMode: toolUseContext.getAppState().toolPermissionContext.mode,
          toolNames: toolUseBlocks.map(block => block.name),
          assistantContent: assistantMessages.flatMap(message => message.message.content),
          permissionDecision: await canUseTool(),
        })
        yield { message: toolResultMessage }
      },
    }

    try {
      const terminal = await drain(
        harness.query({
          messages: [userMessage(`exercise ${permissionMode} permissions`)],
          systemPrompt: ['You are Deep Code.'],
          userContext: {},
          systemContext: {},
          canUseTool: async () => ({
            behavior: permissionMode === 'bypassPermissions' ? 'allow' : 'ask',
            updatedInput: {},
          }),
          querySource: 'sdk',
          maxTurns: 3,
          toolUseContext: createToolUseContext({ permissionMode }),
          deps: createDeepSeekPermissionDeps({
            modelRequests,
            permissionSnapshots,
            permissionMode,
          }),
        }),
      )

      expect(terminal.reason).toBe('completed')
      expect(permissionSnapshots).toEqual([
        { mode: permissionMode },
        { mode: permissionMode },
      ])
      expect(toolExecutions).toHaveLength(1)
      expect(toolExecutions[0].permissionMode).toBe(permissionMode)
      expect(toolExecutions[0].toolNames).toEqual(['Agent', 'Read', 'Edit', 'Bash'])
      expect(toolExecutions[0].assistantContent).toContainEqual({
        type: 'tool_use',
        id: `toolu_${permissionMode}_agent`,
        name: 'Agent',
        input: {
          description: 'Inspect behavior',
          prompt: `Inspect Harness permissions in ${permissionMode}.`,
        },
      })
      expect(toolExecutions[0].permissionDecision.behavior).toBe(
        permissionMode === 'bypassPermissions' ? 'allow' : 'ask',
      )
      expect(
        toolExecutions[0].assistantContent.some(
          block =>
            block.type === 'thinking' &&
            block.thinking === `Need to inspect, edit, and verify in ${permissionMode}.`,
        ),
      ).toBe(true)
      expect(modelRequests).toHaveLength(2)
      const followUpAssistant = modelRequests[1].find(
        message => message.uuid === `assistant-tools-${permissionMode}`,
      )
      expect(followUpAssistant.message.content).toContainEqual({
        type: 'thinking',
        thinking: `Need to inspect, edit, and verify in ${permissionMode}.`,
      })
      expect(modelRequests[1].some(message => message.uuid === `tool-result-${permissionMode}`)).toBe(true)
    } finally {
      delete globalThis.__deepcodeTuiHarness
    }
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

test('production query deps build DeepSeek requests with stable real-tool prefix', async () => {
  const harness = await buildDeepSeekQueryDepsHarness()
  const deps = harness.productionDeps()
  const capturedBodies = []
  const tools = [
    {
      name: 'WriteFile',
      inputJSONSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
      async prompt({ getToolPermissionContext, tools: promptTools }) {
        const permissionContext = await getToolPermissionContext()
        return `Write with mode=${permissionContext.mode}; tools=${promptTools.map(tool => tool.name).join(',')}`
      },
    },
    {
      name: 'ReadFile',
      description: 'Read a workspace file',
      inputJSONSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  ]

  for await (const _ of deps.callModel({
    messages: [userMessage('inspect files')],
    systemPrompt: ['You are Deep Code.'],
    tools,
    signal: new AbortController().signal,
    options: {
      model: 'deepseek-v4-pro',
      getToolPermissionContext: async () => ({ mode: 'default' }),
      fetchOverride: async (_url, init) => {
        capturedBodies.push(JSON.parse(init.body))
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
            'data: {"usage":{"prompt_cache_hit_tokens":4,"prompt_cache_miss_tokens":2}}',
            'data: [DONE]',
            '',
          ].join('\n'),
          { status: 200 },
        )
      },
    },
  })) {
    // Drain the stream.
  }

  expect(capturedBodies).toHaveLength(1)
  // Tool schemas (and their descriptions) ride ONLY the native body.tools array
  // (asserted below) — they are no longer duplicated into the system message via a
  // "Stable tool manifest:" text block.
  expect(capturedBodies[0].messages[0].content).not.toContain('Stable tool manifest:')
  expect(capturedBodies[0].messages[0].content).not.toContain('"name":"ReadFile"')
  expect(capturedBodies[0].messages[0].content).not.toContain('mode=default; tools=WriteFile,ReadFile')
  expect(capturedBodies[0].tools.map(tool => tool.function.name)).toEqual([
    'ReadFile',
    'WriteFile',
  ])
  expect(
    capturedBodies[0].tools.find(tool => tool.function.name === 'WriteFile').function.description,
  ).toContain('mode=default; tools=WriteFile,ReadFile')
})

test('model utilities default to DeepSeek native models', async () => {
  const previousEnv = snapshotEnv([
    'DEEPCODE_PROVIDER',
    'DEEP_CODE_PROVIDER',
    'DEEPSEEK_MODEL',
    'DEEPCODE_MODEL',
    'DEEPSEEK_SMALL_MODEL',
    'DEEPCODE_SMALL_MODEL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
  ])
  delete process.env.DEEPCODE_PROVIDER
  delete process.env.DEEP_CODE_PROVIDER
  delete process.env.DEEPSEEK_MODEL
  delete process.env.DEEPCODE_MODEL
  delete process.env.DEEPSEEK_SMALL_MODEL
  delete process.env.DEEPCODE_SMALL_MODEL
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'
  process.env.ANTHROPIC_SMALL_FAST_MODEL = 'claude-haiku-4-5'

  try {
    const model = await buildDeepSeekModelHarness()

    expect(model.getDefaultMainLoopModelSetting()).toBe('deepseek-v4-pro')
    expect(model.getDefaultMainLoopModel()).toBe('deepseek-v4-pro')
    expect(model.getSmallFastModel()).toBe('deepseek-v4-flash')
    expect(model.getUserSpecifiedModelSetting()).toBeUndefined()
  } finally {
    restoreEnvSnapshot(previousEnv)
  }
})

test('model utilities honor DeepSeek model env overrides', async () => {
  const previousEnv = snapshotEnv([
    'DEEPCODE_PROVIDER',
    'DEEP_CODE_PROVIDER',
    'DEEPSEEK_MODEL',
    'DEEPCODE_MODEL',
    'DEEPSEEK_SMALL_MODEL',
    'DEEPCODE_SMALL_MODEL',
  ])
  delete process.env.DEEPCODE_PROVIDER
  delete process.env.DEEP_CODE_PROVIDER
  process.env.DEEPCODE_MODEL = 'deepseek-v4-custom'
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro-env'
  process.env.DEEPCODE_SMALL_MODEL = 'deepseek-v4-small-custom'
  process.env.DEEPSEEK_SMALL_MODEL = 'deepseek-v4-flash-env'

  try {
    const model = await buildDeepSeekModelHarness()

    expect(model.getUserSpecifiedModelSetting()).toBe('deepseek-v4-pro-env')
    expect(model.getMainLoopModel()).toBe('deepseek-v4-pro-env')
    expect(model.getSmallFastModel()).toBe('deepseek-v4-flash-env')
  } finally {
    restoreEnvSnapshot(previousEnv)
  }
})

test('model picker options are DeepSeek-native under the Deep Code provider', async () => {
  const previousEnv = snapshotEnv([
    'DEEPCODE_PROVIDER',
    'DEEP_CODE_PROVIDER',
    'DEEPSEEK_MODEL',
    'DEEPCODE_MODEL',
    'DEEPSEEK_SMALL_MODEL',
    'DEEPCODE_SMALL_MODEL',
    'ANTHROPIC_CUSTOM_MODEL_OPTION',
    'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
    'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  ])
  delete process.env.DEEPCODE_PROVIDER
  delete process.env.DEEP_CODE_PROVIDER
  delete process.env.DEEPSEEK_MODEL
  delete process.env.DEEPCODE_MODEL
  delete process.env.DEEPSEEK_SMALL_MODEL
  delete process.env.DEEPCODE_SMALL_MODEL
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'claude-opus-4-6'
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = 'Opus'
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = 'Claude custom model'

  try {
    const modelOptions = await buildDeepSeekModelOptionsHarness()
    const options = modelOptions.getModelOptions()
    const visibleText = options
      .flatMap(option => [
        option.label,
        option.description,
        option.descriptionForModel ?? '',
      ])
      .join('\n')

    expect(options.map(option => option.value)).toEqual([
      null,
      'auto',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
    expect(visibleText).toContain('Auto')
    expect(visibleText).toContain('Route each turn')
    expect(visibleText).toContain('DeepSeek V4 Pro')
    expect(visibleText).toContain('DeepSeek V4 Flash')
    expect(visibleText).not.toMatch(/Claude|Opus|Sonnet|Haiku/)
  } finally {
    restoreEnvSnapshot(previousEnv)
  }
})

test('print model metadata resolves default model through DeepSeek-native defaults', async () => {
  const previousEnv = snapshotEnv([
    'DEEPCODE_PROVIDER',
    'DEEP_CODE_PROVIDER',
    'DEEPSEEK_MODEL',
    'DEEPCODE_MODEL',
    'ANTHROPIC_MODEL',
  ])
  delete process.env.DEEPCODE_PROVIDER
  delete process.env.DEEP_CODE_PROVIDER
  delete process.env.DEEPSEEK_MODEL
  delete process.env.DEEPCODE_MODEL
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'

  try {
    const printModelInfo = await buildDeepSeekPrintModelInfoHarness()
    const modelInfos = printModelInfo.buildPrintModelInfos()
    const defaultInfo = modelInfos.find(info => info.value === 'default')

    expect(defaultInfo).toMatchObject({
      value: 'default',
      supportsEffort: true,
      supportsAdaptiveThinking: true,
    })
    expect(defaultInfo.supportedEffortLevels).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
  } finally {
    restoreEnvSnapshot(previousEnv)
  }
})

test('config home defaults to Deep Code paths and keeps Claude env only as legacy fallback', async () => {
  const previousEnv = snapshotEnv([
    'DEEPCODE_CONFIG_DIR',
    'CLAUDE_CONFIG_DIR',
  ])
  const envUtils = await import('../src/utils/envUtils.ts')

  try {
    delete process.env.DEEPCODE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    clearConfigPathCaches(envUtils)

    expect(envUtils.getDeepCodeConfigHomeDir()).toBe(join(homedir(), '.deepcode'))
    expect(envUtils.getClaudeConfigHomeDir()).toBe(join(homedir(), '.deepcode'))
    expect(envUtils.getLegacyClaudeConfigHomeDir()).toBe(join(homedir(), '.claude'))

    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-claude-config'
    clearConfigPathCaches(envUtils)

    expect(envUtils.getDeepCodeConfigHomeDir()).toBe('/tmp/legacy-claude-config')

    process.env.DEEPCODE_CONFIG_DIR = '/tmp/deepcode-config'
    clearConfigPathCaches(envUtils)

    expect(envUtils.getDeepCodeConfigHomeDir()).toBe('/tmp/deepcode-config')
    expect(envUtils.getClaudeConfigHomeDir()).toBe('/tmp/deepcode-config')
    expect(envUtils.getLegacyClaudeConfigHomeDir()).toBe('/tmp/legacy-claude-config')
  } finally {
    restoreEnvSnapshot(previousEnv)
    clearConfigPathCaches(envUtils)
  }
})

test('global config file writes use Deep Code names while exposing legacy Claude candidates', async () => {
  const previousEnv = snapshotEnv([
    'DEEPCODE_CONFIG_DIR',
    'CLAUDE_CONFIG_DIR',
  ])
  const envUtils = await import('../src/utils/envUtils.ts')
  const envSource = readFileSync(
    new URL('../src/utils/env.ts', import.meta.url),
    'utf8',
  )

  try {
    delete process.env.DEEPCODE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    clearConfigPathCaches(envUtils)

    expect(envSource).toContain('getGlobalDeepCodeFile')
    expect(envSource).toContain('.deepcode')
    expect(envSource).toContain('getLegacyGlobalClaudeFileCandidates')
    expect(envSource).toContain('.claude')

    process.env.DEEPCODE_CONFIG_DIR = '/tmp/deepcode-config'
    process.env.CLAUDE_CONFIG_DIR = '/tmp/legacy-claude-config'
    clearConfigPathCaches(envUtils)

    expect(envUtils.getDeepCodeConfigHomeDir()).toBe('/tmp/deepcode-config')
    expect(envUtils.getLegacyClaudeConfigHomeDir()).toBe('/tmp/legacy-claude-config')
  } finally {
    restoreEnvSnapshot(previousEnv)
    clearConfigPathCaches(envUtils)
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

function createToolUseContext({
  permissionMode = 'default',
  tools = [{ name: 'FakeTool' }],
  agentId,
} = {}) {
  const abortController = new AbortController()
  return {
    agentId,
    abortController,
    readFileState: {},
    addNotification() {},
    getAppState() {
      return {
        toolPermissionContext: { mode: permissionMode },
        fastMode: false,
        mcp: { tools: [], clients: [] },
        effortValue: 'max',
        advisorModel: undefined,
      }
    },
    options: {
      tools,
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

function createDeepSeekAgentToolDeps(modelRequests) {
  let callCount = 0
  return {
    uuid: () => `deepcode-agent-uuid-${callCount}`,
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
        yield assistantMessage('assistant-agent-call', [
          {
            type: 'thinking',
            thinking: 'Use one worker and continue after the result.',
          },
          {
            type: 'tool_use',
            id: 'toolu_agent_1',
            name: 'Agent',
            input: {
              description: 'Inspect cache',
              prompt: 'Inspect cache and permission behavior.',
            },
          },
        ])
        return
      }
      yield assistantMessage('assistant-agent-final', [
        { type: 'text', text: 'DeepSeek Harness Agent result integrated.' },
      ])
    },
  }
}

function createDeepSeekPermissionDeps({
  modelRequests,
  permissionSnapshots,
  permissionMode,
}) {
  let callCount = 0
  return {
    uuid: () => `deepcode-permission-uuid-${permissionMode}-${callCount}`,
    async microcompact(messages) {
      return { messages }
    },
    async autocompact() {
      return { compactionResult: null, consecutiveFailures: undefined }
    },
    async *callModel({ messages, options }) {
      permissionSnapshots.push(await options.getToolPermissionContext())
      modelRequests.push(messages)
      callCount += 1
      if (callCount === 1) {
        yield assistantMessage(`assistant-tools-${permissionMode}`, [
          {
            type: 'thinking',
            thinking: `Need to inspect, edit, and verify in ${permissionMode}.`,
          },
          {
            type: 'tool_use',
            id: `toolu_${permissionMode}_agent`,
            name: 'Agent',
            input: {
              description: 'Inspect behavior',
              prompt: `Inspect Harness permissions in ${permissionMode}.`,
            },
          },
          {
            type: 'tool_use',
            id: `toolu_${permissionMode}_read`,
            name: 'Read',
            input: { file_path: 'sample.txt' },
          },
          {
            type: 'tool_use',
            id: `toolu_${permissionMode}_edit`,
            name: 'Edit',
            input: {
              file_path: 'sample.txt',
              old_string: 'alpha',
              new_string: 'beta',
            },
          },
          {
            type: 'tool_use',
            id: `toolu_${permissionMode}_bash`,
            name: 'Bash',
            input: { command: 'cat sample.txt' },
          },
        ])
        return
      }
      yield assistantMessage(`assistant-final-${permissionMode}`, [
        { type: 'text', text: `Done in ${permissionMode}.` },
      ])
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

function snapshotEnv(keys) {
  return new Map(keys.map(key => [key, process.env[key]]))
}

function restoreEnvSnapshot(snapshot) {
  for (const [key, value] of snapshot) {
    restoreEnv(key, value)
  }
}

function clearConfigPathCaches(...modules) {
  for (const module of modules) {
    module.getDeepCodeConfigHomeDir?.cache?.clear?.()
    module.getClaudeConfigHomeDir?.cache?.clear?.()
    module.getLegacyClaudeConfigHomeDir?.cache?.clear?.()
    module.getGlobalDeepCodeFile?.cache?.clear?.()
    module.getGlobalClaudeFile?.cache?.clear?.()
    module.getLegacyGlobalClaudeFileCandidates?.cache?.clear?.()
  }
}
