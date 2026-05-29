import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const mcp = {
  type: 'local-jsx',
  name: 'mcp',
  description: translate('en', 'command.mcp.description'),
  immediate: true,
  argumentHint: '[enable|disable [server-name]]',
  load: () => import('./mcp.js'),
} satisfies Command

export default mcp
