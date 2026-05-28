import type { Command } from '../../commands.js'
import { translate } from '../../i18n/index.js'

const resume: Command = {
  type: 'local-jsx',
  name: 'resume',
  description: translate('en', 'command.resume.description'),
  aliases: ['continue'],
  argumentHint: '[conversation id or search term]',
  load: () => import('./resume.js'),
}

export default resume
