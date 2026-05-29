import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: translate('en', 'command.stats.description'),
  load: () => import('./stats.js'),
} satisfies Command

export default stats
