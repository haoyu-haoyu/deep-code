import { isEnvTruthy } from './envUtils.js'

export function hasConsoleBillingAccess(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COST_WARNINGS)) {
    return false
  }
  return false
}

let mockBillingAccessOverride: boolean | null = null

export function setMockBillingAccessOverride(value: boolean | null): void {
  mockBillingAccessOverride = value
}

export function hasClaudeAiBillingAccess(): boolean {
  if (mockBillingAccessOverride !== null) {
    return mockBillingAccessOverride
  }
  return false
}
