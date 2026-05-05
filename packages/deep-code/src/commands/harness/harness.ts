import {
  formatDeepCodeHarnessStatus,
  resolveDeepCodeHarnessConfig,
} from '../../deepcode/harness-config.mjs'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  return {
    type: 'text',
    value: formatDeepCodeHarnessStatus(resolveDeepCodeHarnessConfig()),
  }
}
