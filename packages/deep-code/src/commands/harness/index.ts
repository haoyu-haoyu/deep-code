import type { Command } from '../../commands.js'

const harness = {
  type: 'local',
  name: 'harness',
  description:
    'Show DeepSeek Harness mode, prompt pack, agent limits, and strict tool settings',
  supportsNonInteractive: true,
  load: () => import('./harness.js'),
} satisfies Command

export default harness
