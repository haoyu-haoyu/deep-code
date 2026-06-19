import { resolveDeepCodeHarnessConfig } from '../../deepcode/harness-config.mjs'

// Single source of truth for the DEEPCODE_STRICT_TOOLS mode actually applied to a
// DeepSeek request. The WIRE (buildDeepSeekRequest) and the cache-prefix hash
// (createDeepCodeStablePrefix) MUST resolve it identically — otherwise the
// recorded prefixHash fingerprints a different (always off-mode) tool render than
// the bytes actually sent, so the prefix-change detector reports `unchanged` even
// when a mid-session strict-mode toggle changed the real wire tool block (and
// DeepSeek's cache key). This is the deepseek.mjs strictMode ladder, extracted so
// both renderers can't drift.
//
//   - strictTools === true  -> 'all'  (back-compat boolean override)
//   - strictTools === false -> 'off'
//   - otherwise             -> resolveDeepCodeHarnessConfig(env).strictTools
//                              (the DEEPCODE_STRICT_TOOLS env; default 'off')
//
// @param {{ strictTools?: boolean, env?: NodeJS.ProcessEnv }} [opts]
// @returns {'off'|'safe'|'all'|'nullable'}
export function resolveStrictMode({ strictTools, env = process.env } = {}) {
  if (strictTools === true) return 'all'
  if (strictTools === false) return 'off'
  return resolveDeepCodeHarnessConfig(env).strictTools
}
