import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const restore = {
  type: 'local-jsx',
  name: 'restore',
  description: translate('en', 'command.restore.description'),
  argumentHint: '[snapshot-id]',
  isEnabled: () => true,
  load: () => import('./restore.js'),
} satisfies Command

export default restore
