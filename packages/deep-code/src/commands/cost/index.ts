/**
 * Cost command - minimal metadata only.
 * Implementation is lazy-loaded from cost.ts to reduce startup time.
 */
import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const cost = {
  type: 'local',
  name: 'cost',
  description: translate('en', 'command.cost.description'),
  isHidden: false,
  supportsNonInteractive: true,
  load: () => import('./cost.js'),
} satisfies Command

export default cost
