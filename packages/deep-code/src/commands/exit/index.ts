import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const exit = {
  type: 'local-jsx',
  name: 'exit',
  aliases: ['quit'],
  description: translate('en', 'command.exit.description'),
  immediate: true,
  load: () => import('./exit.js'),
} satisfies Command

export default exit
