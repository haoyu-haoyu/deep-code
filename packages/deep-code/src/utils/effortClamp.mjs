// Clamp a resolved effort level down to what the target model actually accepts,
// deepest-first. The DeepSeek-v4 server accepts a graded ladder
// {low,medium,high,max,xhigh} (probe-confirmed), but other providers do not:
//   - xhigh is DeepSeek-only            → clamp to max for models without it
//   - max is Opus-4.6 / DeepSeek only   → clamp to high for models without it
// (an API call with an unsupported tier is rejected, so this is a correctness
// clamp, not a preference). Numeric (ANT-only) and undefined efforts pass
// through untouched, exactly as the prior inline `max → high` check did.
//
// This generalizes the previous single `resolved === 'max' && !supportsMax`
// downgrade in resolveAppliedEffort into a two-step ladder so xhigh degrades
// gracefully (xhigh → max → high) on a model that supports neither.
export function clampUnsupportedEffort(effort, { supportsMax, supportsXhigh }) {
  let level = effort
  if (level === 'xhigh' && !supportsXhigh) level = 'max'
  if (level === 'max' && !supportsMax) level = 'high'
  return level
}
