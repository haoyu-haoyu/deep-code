import type { Command } from '../../commands.js'

const restore = {
  type: 'local-jsx',
  name: 'restore',
  description: 'Restore workspace from a snapshot taken before a previous turn',
  argumentHint: '[snapshot-id]',
  isEnabled: () => true,
  load: () => import('./restore.js'),
} satisfies Command

export default restore
