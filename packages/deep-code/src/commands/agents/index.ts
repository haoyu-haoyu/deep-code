import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const agents = {
  type: 'local-jsx',
  name: 'agents',
  description: translate('en', 'command.agents.description'),
  load: () => import('./agents.js'),
} satisfies Command

export default agents
