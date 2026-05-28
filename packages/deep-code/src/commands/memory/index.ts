import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: translate('en', 'command.memory.description'),
  load: () => import('./memory.js'),
}

export default memory
