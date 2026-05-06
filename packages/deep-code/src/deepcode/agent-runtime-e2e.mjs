import {
  calculateDeepSeekCacheHitRate,
  createDeepSeekProvider,
  runDeepSeekAgent,
} from './deepseek-native.mjs'
import {
  getLastDeepCodeHarnessAgentLifecycle,
  recordDeepCodeHarnessAgentLifecycle,
  recordDeepCodeHarnessRuntimeDecision,
  resolveDeepCodeDefaultSubagentType,
  resolveDeepCodeHarnessRuntime,
} from './harness-runtime.mjs'

export async function runDeepCodeAgentRuntimeE2E({
  env = process.env,
  cwd = process.cwd(),
  provider = createDeepSeekProvider(),
  complete,
} = {}) {
  const prompt = [
    'Call the Agent tool exactly once without subagent_type.',
    'Use description "Inspect lifecycle" and prompt "Inspect DeepSeek Harness lifecycle."',
    'After the tool result, answer exactly: deepcode-agent-e2e-ok',
  ].join('\n')
  const runtimeDecision = resolveDeepCodeHarnessRuntime({
    env,
    prompt,
    isMainAgent: true,
    permissionMode: 'default',
  })
  recordDeepCodeHarnessRuntimeDecision(runtimeDecision)

  const tools = [
    {
      name: 'Agent',
      description:
        'Launch a Deep Code Harness subagent for a focused independent task.',
      inputJSONSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Short description of the delegated task.',
          },
          prompt: {
            type: 'string',
            description: 'Self-contained subagent instructions.',
          },
          subagent_type: {
            type: 'string',
            description:
              'Optional DeepSeek Harness profile: explorer, worker, verification, summarizer.',
          },
        },
        required: ['description', 'prompt'],
      },
      async execute(input) {
        const selectedProfile =
          input.subagent_type ??
          resolveDeepCodeDefaultSubagentType({
            env,
            prompt: input.prompt,
            isMainAgent: true,
            permissionMode: 'default',
            runtimeDecision,
          })
        recordDeepCodeHarnessAgentLifecycle({
          selectedProfile,
          requestedProfile: input.subagent_type,
          selection: input.subagent_type ? 'explicit' : 'default',
          parentRuntimeDecision: runtimeDecision,
          permissionMode: 'default',
        })
        return [
          `Agent profile: ${selectedProfile}`,
          `Description: ${input.description}`,
          `Result: inspected DeepSeek Harness lifecycle.`,
        ].join('\n')
      },
    },
  ]

  const result = await runDeepSeekAgent({
    prompt,
    env,
    cwd,
    provider,
    complete,
    maxTurns: 4,
    systemPrompt: [
      'You are Deep Code running a DeepSeek Harness Agent runtime E2E.',
      'When the user asks you to call a tool, call the function tool instead of describing it.',
    ],
    tools,
  })
  const content = result.content.trim()
  const lifecycle = getLastDeepCodeHarnessAgentLifecycle()
  const cacheDiagnostics = createCacheDiagnostics(result.usage)

  return {
    ok:
      content === 'deepcode-agent-e2e-ok' &&
      lifecycle?.selectedProfile === 'worker',
    content,
    usage: result.usage,
    cacheDiagnostics,
    lifecycle,
    runtimeDecision,
  }
}

function createCacheDiagnostics(usage = {}) {
  const hit = usage?.prompt_cache_hit_tokens ?? 0
  const miss = usage?.prompt_cache_miss_tokens ?? 0
  return {
    promptCacheHitTokens: hit,
    promptCacheMissTokens: miss,
    promptCacheHitRate: calculateDeepSeekCacheHitRate(usage),
  }
}
