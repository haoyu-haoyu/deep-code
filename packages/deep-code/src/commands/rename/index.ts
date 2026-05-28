import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const rename = {
  type: 'local-jsx',
  name: 'rename',
  description: translate('en', 'command.rename.description'),
  immediate: true,
  argumentHint: '[name]',
  load: () => import('./rename.js'),
} satisfies Command

export default rename
