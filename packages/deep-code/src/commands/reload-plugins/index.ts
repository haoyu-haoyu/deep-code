/**
 * /reload-plugins — Layer-3 refresh. Applies pending plugin changes to the
 * running session. Implementation lazy-loaded.
 */
import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const reloadPlugins = {
  type: 'local',
  name: 'reload-plugins',
  description: translate('en', 'command.reloadPlugins.description'),
  // SDK callers use query.reloadPlugins() (control request) instead of
  // sending this as a text prompt — that returns structured data
  // (commands, agents, plugins, mcpServers) for UI updates.
  supportsNonInteractive: false,
  load: () => import('./reload-plugins.js'),
} satisfies Command

export default reloadPlugins
