import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: translate('en', 'command.skills.description'),
  load: () => import('./skills.js'),
} satisfies Command

export default skills
