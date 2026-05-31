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
import { getMessage } from '../../i18n/index.js'

export const call: LocalCommandCall = async () => {
  const lastDecision = getLastDeepCodeHarnessRuntimeDecision()
  return {
    type: 'text',
    value: [
      formatDeepCodeHarnessStatus(resolveDeepCodeHarnessConfig()),
      getMessage('command.harness.autoModeDescription'),
      lastDecision
        ? formatDeepCodeHarnessRuntimeDecision(lastDecision)
        : getMessage('command.harness.runtimeUnavailable'),
    ].join('\n'),
  }
}
