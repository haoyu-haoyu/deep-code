// Apply the env-over-session effort precedence to the value that goes on the
// DeepSeek wire (options.effortValue → reasoning_effort).
//
// THE BUG this fixes: there were TWO non-equivalent effort-precedence chains.
//   - DISPLAY (resolveAppliedEffort, effort.ts): env → appState → model default,
//     i.e. CLAUDE_CODE_EFFORT_LEVEL WINS over the session /effort value. Every
//     status/Logo/Spinner surface and the /effort command's own message route
//     through it — the message literally promises "CLAUDE_CODE_EFFORT_LEVEL=…
//     overrides this session".
//   - WIRE (resolveDeepSeekConfig, deepseek.mjs): overrides.reasoningEffort
//     (= the RAW appState.effortValue) FIRST, shadowing every env var. So when a
//     session /effort value was set, the env override the display PROMISED was
//     silently dropped on the wire — the model ran at a different effort than the
//     UI claimed.
//
// We resolve the env precedence HERE, at the wire call site, before the value
// reaches options.effortValue, so the wire matches the display.
//
// CRITICAL INVARIANT: when nothing is explicitly set this must return `undefined`
// (NOT the model default the way resolveAppliedEffort substitutes), so the
// downstream resolveDeepSeekConfig `?? DEEPSEEK_REASONING_EFFORT ?? … ?? 'max'`
// fallback chain still runs intact. Substituting 'max' here would shadow those
// env/file fallbacks and change the common default request bytes (cache moat).
//
// @param {('low'|'medium'|'high'|'max'|'xhigh'|number)|null|undefined} envOverride
//   getEffortEnvOverride() result: an EffortValue (explicit env level), `null`
//   (env literally 'unset'/'auto' → suppress the session value, exactly as the
//   display does), or `undefined` (no env override present).
// @param {('low'|'medium'|'high'|'max'|'xhigh'|number)|undefined} appStateEffortValue
//   the session effort (AppState.effortValue), or undefined.
// @returns the wire effort value, or undefined to let the wire default chain run.
export function applyWireEffortPrecedence(envOverride, appStateEffortValue) {
  // Explicit 'unset'/'auto' suppresses the session value — mirrors
  // resolveAppliedEffort returning undefined for envOverride === null.
  if (envOverride === null) return undefined
  // An explicit env level wins over the session value; otherwise the session
  // value; otherwise undefined (never the model default — see header).
  return envOverride ?? appStateEffortValue
}
