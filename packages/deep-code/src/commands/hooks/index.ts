import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const hooks = {
  type: 'local-jsx',
  name: 'hooks',
  description: translate('en', 'command.hooks.description'),
  immediate: true,
  load: () => import('./hooks.js'),
} satisfies Command

export default hooks
