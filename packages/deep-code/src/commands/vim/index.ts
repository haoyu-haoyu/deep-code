import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const command = {
  name: 'vim',
  description: translate('en', 'command.vim.description'),
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./vim.js'),
} satisfies Command

export default command
