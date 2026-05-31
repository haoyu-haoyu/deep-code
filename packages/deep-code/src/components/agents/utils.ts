import capitalize from 'lodash-es/capitalize.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { getSettingSourceName } from 'src/utils/settings/constants.js'
import { getMessage } from '../../i18n/index.js'

export function getAgentSourceDisplayName(
  source: SettingSource | 'all' | 'built-in' | 'plugin',
): string {
  if (source === 'all') {
    return getMessage('agents.source.all')
  }
  if (source === 'built-in') {
    return getMessage('agents.source.builtIn')
  }
  if (source === 'plugin') {
    return getMessage('agents.source.plugin')
  }
  return capitalize(getSettingSourceName(source))
}
