import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const outputStyle = {
  type: 'local-jsx',
  name: 'output-style',
  description: translate('en', 'command.outputStyle.description'),
  isHidden: true,
  load: () => import('./output-style.js'),
} satisfies Command

export default outputStyle
