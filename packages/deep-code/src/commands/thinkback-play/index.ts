import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../utils/featureFlags.js'

// Hidden command that just plays the animation
// Called by the thinkback skill after generation is complete
const thinkbackPlay = {
  type: 'local',
  name: 'thinkback-play',
  description: translate('en', 'command.thinkbackPlay.description'),
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  isHidden: true,
  supportsNonInteractive: false,
  load: () => import('./thinkback-play.js'),
} satisfies Command

export default thinkbackPlay
