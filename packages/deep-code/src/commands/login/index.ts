import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default {
  type: 'local-jsx',
  name: 'login',
  description: translate('en', 'command.login.description'),
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
  load: () => import('./login.js'),
} satisfies Command
