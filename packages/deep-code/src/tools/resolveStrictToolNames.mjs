import { isDeepStrictEqual } from 'node:util'
import { sanitizeSchemaForDeepSeekStrict } from './deepseek-schema.mjs'

// Decide which tools should use DeepSeek /beta strict function-calling, given
// the DEEPCODE_STRICT_TOOLS mode (off | safe | all).
//
// toolToDeepSeekFunctionSchema(tool, { strict: true }) runs the schema through
// sanitizeSchemaForDeepSeekStrict, which RECURSIVELY forces every object node's
// `required` to all its declared properties (and sets additionalProperties:false).
// For a tool with optional params that would force the model to emit every
// optional argument on every call — a behavioral regression (Read offset/limit,
// Edit replace_all, Bash timeout, …). So strict must be applied selectively:
//   - 'off'  -> no tool is strict (default; byte-identical to non-strict today).
//   - 'safe' -> only tools the strict sanitizer would leave UNCHANGED, so the
//               rewrite is a true no-op that only adds /beta enforcement and can
//               never force a previously-optional argument.
//   - 'all'  -> every named tool (accepts the all-required risk; explicit opt-in).
//
// Returns a Set of tool names. The caller flips to the /beta base URL only when
// the set is non-empty, so the cached-prefix base URL is unchanged otherwise.
/**
 * @param {string} mode 'off' | 'safe' | 'all' (anything else => off)
 * @param {ReadonlyArray<unknown>} tools
 * @returns {Set<string>}
 */
export function resolveStrictToolNames(mode, tools) {
  const names = new Set()
  if (mode !== 'safe' && mode !== 'all') {
    return names
  }
  for (const tool of tools ?? []) {
    const name = toolName(tool)
    if (!name) continue
    if (mode === 'all') {
      names.add(name)
      continue
    }
    // 'safe': a missing/null schema becomes an empty object schema under strict,
    // which GAINS additionalProperties:false — a change — so it is not no-op-safe.
    const schema = toolSchema(tool)
    if (schema !== null && isStrictNoOpSchema(schema)) {
      names.add(name)
    }
  }
  return names
}

function toolName(tool) {
  const name = tool?.name ?? tool?.function?.name
  return typeof name === 'string' && name ? name : null
}

function toolSchema(tool) {
  return (
    tool?.inputJSONSchema ??
    tool?.input_schema ??
    tool?.parameters ??
    tool?.function?.parameters ??
    null
  )
}

// True iff the strict sanitizer leaves this schema unchanged. Defined as
// structural identity against the REAL sanitizer (the single source of truth),
// so it can never drift from sanitizeSchemaForDeepSeekStrict's actual recursion
// — which rewrites EVERY object node it reaches (including ones under
// definitions/patternProperties/prefixItems or any other keyword). isDeepStrictEqual
// ignores object key order (the sanitizer sorts keys) but is order-sensitive for
// arrays such as `required`, so any genuine semantic change — or even a non-sorted
// required list — is conservatively treated as "not a no-op".
function isStrictNoOpSchema(schema) {
  return isDeepStrictEqual(sanitizeSchemaForDeepSeekStrict(schema), schema)
}
