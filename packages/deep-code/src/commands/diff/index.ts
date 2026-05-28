import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

export default {
  type: 'local-jsx',
  name: 'diff',
  description: translate('en', 'command.diff.description'),
  load: () => import('./diff.js'),
} satisfies Command
