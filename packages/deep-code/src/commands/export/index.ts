import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const exportCommand = {
  type: 'local-jsx',
  name: 'export',
  description: translate('en', 'command.export.description'),
  argumentHint: '[filename]',
  load: () => import('./export.js'),
} satisfies Command

export default exportCommand
