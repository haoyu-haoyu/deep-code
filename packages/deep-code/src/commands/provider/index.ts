import type { Command } from '../../commands.js'

const provider = {
  type: 'local',
  name: 'provider',
  description:
    'Switch model provider (deepseek/ollama/vllm/openai-compatible)',
  argumentHint: '[deepseek|ollama|vllm|openai-compatible]',
  supportsNonInteractive: true,
  load: () => import('./provider.js'),
} satisfies Command

export default provider
