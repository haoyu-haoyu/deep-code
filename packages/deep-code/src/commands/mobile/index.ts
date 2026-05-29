import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const mobile = {
  type: 'local-jsx',
  name: 'mobile',
  aliases: ['ios', 'android'],
  description: translate('en', 'command.mobile.description'),
  load: () => import('./mobile.js'),
} satisfies Command

export default mobile
