import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const files = {
  type: 'local',
  name: 'files',
  description: translate('en', 'command.files.description'),
  isEnabled: () => process.env.USER_TYPE === 'ant',
  supportsNonInteractive: true,
  load: () => import('./files.js'),
} satisfies Command

export default files
