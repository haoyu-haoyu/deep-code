import type { Command } from '../../commands.js';
import { translate } from '../../i18n/index.js';

const locale = {
  type: 'local-jsx',
  name: 'locale',
  description: translate('en', 'command.locale.description'),
  load: () => import('./locale.js'),
} satisfies Command;

export default locale;
