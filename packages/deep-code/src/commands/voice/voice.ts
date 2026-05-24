import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  return {
    type: 'text' as const,
    value: 'Voice mode is unavailable in this build.',
  }
}
