import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const help = {
  type: 'local-jsx',
  name: 'help',
  description: translate('en', 'command.help.description'),
  load: () => import('./help.js'),
} satisfies Command

export default help
