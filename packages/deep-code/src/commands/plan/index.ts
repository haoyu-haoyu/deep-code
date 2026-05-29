import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const plan = {
  type: 'local-jsx',
  name: 'plan',
  description: translate('en', 'command.plan.description'),
  argumentHint: '[open|<description>]',
  load: () => import('./plan.js'),
} satisfies Command

export default plan
