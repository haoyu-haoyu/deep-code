import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const permissions = {
  type: 'local-jsx',
  name: 'permissions',
  aliases: ['allowed-tools'],
  description: translate('en', 'command.permissions.description'),
  load: () => import('./permissions.js'),
} satisfies Command

export default permissions
