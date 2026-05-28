import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const cache = {
  type: 'local-jsx',
  name: 'cache',
  description: translate('en', 'command.cache.description'),
  argumentHint: '[inspect|warmup|clear]',
  isEnabled: () => true,
  load: () => import('./cache.js'),
} satisfies Command

export default cache
