import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  // 'fork' alias only when /fork doesn't exist as its own command
  aliases: feature('FORK_SUBAGENT') ? [] : ['fork'],
  description: translate('en', 'command.branch.description'),
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
