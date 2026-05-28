import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const config = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  description: translate('en', 'command.config.description'),
  load: () => import('./config.js'),
} satisfies Command

export default config
