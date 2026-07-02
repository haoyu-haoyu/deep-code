import { isAutoModelSetting } from './autoModelSetting.mjs'

// Resolve the model used for CONTEXT SIZING (window / auto-compact threshold /
// max-output / %-used / PROMPT_TOO_LONG gate).
//
// The 'auto' per-turn routing sentinel is resolved to a concrete deepseek-v4 model
// (flash or pro) only inside the send path (resolveAutoRoute), per turn, and is NEVER
// written back to the main-loop model. So the context-sizing path (modelSupports1M /
// getContextWindowForModel / getModelMaxOutputTokens) sees the raw 'auto', which
// isDeepSeekModelName / isDeepSeekV4Model do NOT recognize ('auto' does not start with
// 'deepseek') → sizing falls through to the 200k Anthropic default instead of
// DeepSeek's 1M window. That makes auto-compaction fire ~6x too early (at ~167k
// instead of ~967k, discarding live context), trips PROMPT_TOO_LONG at ~177k with
// ~800k free, and inflates the context-%/status-line display ~5x.
//
// Both routing targets (deepseek-v4-flash / deepseek-v4-pro) are deepseek-v4 models
// with a 1M window and the SAME max-output policy, so which one a given turn picks is
// immaterial for sizing — resolve 'auto' to a representative deepseek-v4 model
// (deepseek-v4-pro, the auto pro routing default) so context sizing matches the model
// that actually runs. Every non-'auto' model passes through unchanged (byte-identical
// sizing for all concrete models).
//
// @param {string} model
// @returns {string}
export const AUTO_ROUTE_SIZING_MODEL = 'deepseek-v4-pro'

export function resolveContextSizingModel(model) {
  return isAutoModelSetting(model) ? AUTO_ROUTE_SIZING_MODEL : model
}
