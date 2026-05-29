import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js'

const keybindings = {
  name: 'keybindings',
  description: translate('en', 'command.keybindings.description'),
  isEnabled: () => isKeybindingCustomizationEnabled(),
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./keybindings.js'),
} satisfies Command

export default keybindings
