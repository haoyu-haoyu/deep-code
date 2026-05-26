import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../utils/featureFlags.js'
import {
  CAPPED_DEFAULT_MAX_TOKENS,
  getModelMaxOutputTokens,
} from '../../utils/context.js'
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js'

/**
 * Slot-reservation cap toggle. Mirrors the legacy API-layer helper so the
 * runtime layer owns the policy decision.
 *
 * 3P default: false (not validated on Bedrock/Vertex).
 */
function isMaxTokensCapEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_otk_slot_v1', false)
}

/**
 * Compute the max_tokens cap for a model.
 *
 * Slot-reservation cap: drop default to 8k for all models. BQ p99 output
 * = 4,911 tokens; 32k/64k defaults over-reserve 8-16x slot capacity.
 * Requests hitting the cap get one clean retry at 64k (query.ts
 * max_output_tokens_escalate). Math.min keeps models with lower native
 * defaults (e.g. claude-3-opus at 4k) at their native value. Applied
 * before the env-var override so CLAUDE_CODE_MAX_OUTPUT_TOKENS still wins.
 */
export function getMaxOutputTokensForModel(model: string): number {
  const maxOutputTokens = getModelMaxOutputTokens(model)

  const defaultTokens = isMaxTokensCapEnabled()
    ? Math.min(maxOutputTokens.default, CAPPED_DEFAULT_MAX_TOKENS)
    : maxOutputTokens.default

  const result = validateBoundedIntEnvVar(
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    defaultTokens,
    maxOutputTokens.upperLimit,
  )
  return result.effective
}
