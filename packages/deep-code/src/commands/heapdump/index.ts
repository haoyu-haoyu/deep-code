import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const heapDump = {
  type: 'local',
  name: 'heapdump',
  description: translate('en', 'command.heapdump.description'),
  isHidden: true,
  supportsNonInteractive: true,
  load: () => import('./heapdump.js'),
} satisfies Command

export default heapDump
