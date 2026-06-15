import type { ModelInfo } from 'src/entrypoints/agentSdkTypes.js'
import { modelSupportsAutoMode } from 'src/utils/betas.js'
import {
  EFFORT_LEVELS,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  modelSupportsXhighEffort,
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
        // Advertise each tier only on a model that actually accepts it: 'max' is
        // Opus-4.6 / DeepSeek only, 'xhigh' is DeepSeek-only. (Mirrors the
        // per-tier clamp in resolveAppliedEffort.)
        supportedEffortLevels: EFFORT_LEVELS.filter(
          l =>
            (l !== 'max' || modelSupportsMaxEffort(resolvedModel)) &&
            (l !== 'xhigh' || modelSupportsXhighEffort(resolvedModel)),
        ),
      }),
      ...(hasAdaptiveThinking && { supportsAdaptiveThinking: true }),
      ...(hasFastMode && { supportsFastMode: true }),
      ...(hasAutoMode && { supportsAutoMode: true }),
    }
  })
}
