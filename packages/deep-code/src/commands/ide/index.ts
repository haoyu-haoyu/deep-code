import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const ide = {
  type: 'local-jsx',
  name: 'ide',
  description: translate('en', 'command.ide.description'),
  argumentHint: '[open]',
  load: () => import('./ide.js'),
} satisfies Command

export default ide
