import {
  formatDeepCodeHarnessStatus,
  resolveDeepCodeHarnessConfig,
} from '../../deepcode/harness-config.mjs'
// @ts-expect-error Deep Code harness runtime is JS while slash commands remain TypeScript.
import {
  formatDeepCodeHarnessRuntimeDecision,
  getLastDeepCodeHarnessRuntimeDecision,
} from '../../deepcode/harness-runtime.mjs'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  const lastDecision = getLastDeepCodeHarnessRuntimeDecision()
  return {
    type: 'text',
    value: [
      formatDeepCodeHarnessStatus(resolveDeepCodeHarnessConfig()),
      'Auto mode evaluates each user turn and injects runtime Harness guidance only for complex work.',
      lastDecision
        ? formatDeepCodeHarnessRuntimeDecision(lastDecision)
        : 'Harness runtime: unavailable',
    ].join('\n'),
  }
}
