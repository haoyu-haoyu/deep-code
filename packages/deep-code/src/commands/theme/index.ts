import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const theme = {
  type: 'local-jsx',
  name: 'theme',
  description: translate('en', 'command.theme.description'),
  load: () => import('./theme.js'),
} satisfies Command

export default theme
