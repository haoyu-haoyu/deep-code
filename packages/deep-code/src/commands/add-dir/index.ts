import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const addDir = {
  type: 'local-jsx',
  name: 'add-dir',
  description: translate('en', 'command.addDir.description'),
  argumentHint: '<path>',
  load: () => import('./add-dir.js'),
} satisfies Command

export default addDir
