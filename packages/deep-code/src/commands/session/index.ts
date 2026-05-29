import { getIsRemoteMode } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const session = {
  type: 'local-jsx',
  name: 'session',
  aliases: ['remote'],
  description: translate('en', 'command.session.description'),
  isEnabled: () => getIsRemoteMode(),
  get isHidden() {
    return !getIsRemoteMode()
  },
  load: () => import('./session.js'),
} satisfies Command

export default session
