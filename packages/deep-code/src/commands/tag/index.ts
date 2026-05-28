import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const tag = {
  type: 'local-jsx',
  name: 'tag',
  description: translate('en', 'command.tag.description'),
  isEnabled: () => process.env.USER_TYPE === 'ant',
  argumentHint: '<tag-name>',
  load: () => import('./tag.js'),
} satisfies Command

export default tag
