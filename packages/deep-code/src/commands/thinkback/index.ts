import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../utils/featureFlags.js'

const thinkback = {
  type: 'local-jsx',
  name: 'think-back',
  description: translate('en', 'command.thinkback.description'),
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  load: () => import('./thinkback.js'),
} satisfies Command

export default thinkback
