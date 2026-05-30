import type { Command } from '../commands.js'
import { getMessage, translate } from '../i18n/index.js'
import type { LocalCommandCall } from '../types/command.js'
import {
  canUserConfigureAdvisor,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../utils/advisor.js'
import {
  getDefaultMainLoopModelSetting,
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { validateModel } from '../utils/model/validateModel.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'

const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim().toLowerCase()
  const baseModel = parseUserSpecifiedModel(
    context.getAppState().mainLoopModel ?? getDefaultMainLoopModelSetting(),
  )

  if (!arg) {
    const current = context.getAppState().advisorModel
    if (!current) {
      return {
        type: 'text',
        value: getMessage('command.advisor.notSet'),
      }
    }
    if (!modelSupportsAdvisor(baseModel)) {
      return {
        type: 'text',
        value: getMessage('command.advisor.inactive', {
          current,
          baseModel,
        }),
      }
    }
    return {
      type: 'text',
      value: getMessage('command.advisor.current', { current }),
    }
  }

  if (arg === 'unset' || arg === 'off') {
    const prev = context.getAppState().advisorModel
    context.setAppState(s => {
      if (s.advisorModel === undefined) return s
      return { ...s, advisorModel: undefined }
    })
    updateSettingsForSource('userSettings', { advisorModel: undefined })
    return {
      type: 'text',
      value: prev
        ? getMessage('command.advisor.disabled', { prev })
        : getMessage('command.advisor.alreadyUnset'),
    }
  }

  const normalizedModel = normalizeModelStringForAPI(arg)
  const resolvedModel = parseUserSpecifiedModel(arg)
  const { valid, error } = await validateModel(resolvedModel)
  if (!valid) {
    return {
      type: 'text',
      value: error
        ? getMessage('command.advisor.invalidModel', { error })
        : getMessage('command.advisor.unknownModel', { arg, resolvedModel }),
    }
  }

  if (!isValidAdvisorModel(resolvedModel)) {
    return {
      type: 'text',
      value: getMessage('command.advisor.cannotUse', { arg, resolvedModel }),
    }
  }

  context.setAppState(s => {
    if (s.advisorModel === normalizedModel) return s
    return { ...s, advisorModel: normalizedModel }
  })
  updateSettingsForSource('userSettings', { advisorModel: normalizedModel })

  if (!modelSupportsAdvisor(baseModel)) {
    return {
      type: 'text',
      value: getMessage('command.advisor.setUnsupported', {
        normalizedModel,
        baseModel,
      }),
    }
  }

  return {
    type: 'text',
    value: getMessage('command.advisor.set', { normalizedModel }),
  }
}

const advisor = {
  type: 'local',
  name: 'advisor',
  description: translate('en', 'command.advisor.description'),
  argumentHint: '[<model>|off]',
  isEnabled: () => canUserConfigureAdvisor(),
  get isHidden() {
    return !canUserConfigureAdvisor()
  },
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default advisor
