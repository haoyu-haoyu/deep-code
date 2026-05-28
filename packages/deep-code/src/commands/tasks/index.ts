import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const tasks = {
  type: 'local-jsx',
  name: 'tasks',
  aliases: ['bashes'],
  description: translate('en', 'command.tasks.description'),
  load: () => import('./tasks.js'),
} satisfies Command

export default tasks
