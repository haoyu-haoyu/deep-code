import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const releaseNotes: Command = {
  description: translate('en', 'command.releaseNotes.description'),
  name: 'release-notes',
  type: 'local',
  supportsNonInteractive: true,
  load: () => import('./release-notes.js'),
}

export default releaseNotes
