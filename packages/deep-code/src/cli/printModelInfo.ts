import type { ModelInfo } from 'src/entrypoints/agentSdkTypes.js'
import { modelSupportsAutoMode } from 'src/utils/betas.js'
import {
  EFFORT_LEVELS,
  modelSupportsEffort,
  modelSupportsMaxEffort,
} from 'src/utils/effort.js'
import { isFastModeSupportedByModel } from 'src/utils/fastMode.js'
import {
  getDefaultMainLoopModel,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import { getModelOptions } from 'src/utils/model/modelOptions.js'
import { modelSupportsAdaptiveThinking } from 'src/utils/thinking.js'

export function buildPrintModelInfos(): ModelInfo[] {
  const modelOptions = getModelOptions()
  return modelOptions.map(option => {
    const modelId = option.value === null ? 'default' : option.value
    const resolvedModel =
      modelId === 'default'
        ? getDefaultMainLoopModel()
        : parseUserSpecifiedModel(modelId)
    const hasEffort = modelSupportsEffort(resolvedModel)
    const hasAdaptiveThinking = modelSupportsAdaptiveThinking(resolvedModel)
    const hasFastMode = isFastModeSupportedByModel(option.value)
    const hasAutoMode = modelSupportsAutoMode(resolvedModel)
    return {
      value: modelId,
      displayName: option.label,
      description: option.description,
      ...(hasEffort && {
        supportsEffort: true,
        supportedEffortLevels: modelSupportsMaxEffort(resolvedModel)
          ? [...EFFORT_LEVELS]
          : EFFORT_LEVELS.filter(l => l !== 'max'),
      }),
      ...(hasAdaptiveThinking && { supportsAdaptiveThinking: true }),
      ...(hasFastMode && { supportsFastMode: true }),
      ...(hasAutoMode && { supportsAutoMode: true }),
    }
  })
}
