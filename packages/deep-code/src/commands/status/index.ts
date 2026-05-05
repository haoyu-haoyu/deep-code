import type { Command } from '../../commands.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    'Show Deep Code status including version, DeepSeek model, provider, cache telemetry, and tool statuses',
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status
