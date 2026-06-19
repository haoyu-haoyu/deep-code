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
//   - 'off'      -> no tool is strict (default; byte-identical to non-strict today).
//   - 'safe'     -> only tools the strict sanitizer would leave UNCHANGED, so the
//                   rewrite is a true no-op that only adds /beta enforcement and can
//                   never force a previously-optional argument.
//   - 'all'      -> every named tool (accepts the all-required risk; explicit opt-in).
//   - 'nullable' -> every named tool, but rendered with the nullable sanitizer
//                   (required = all props, originally-optional ones widened to allow
//                   null) — strict enforcement for the WHOLE surface without forcing
//                   optionals to a value. Selection is identical to 'all'; only the
//                   renderer's sanitizer differs.
//
// Returns a Set of tool names. The caller flips to the /beta base URL only when
// the set is non-empty, so the cached-prefix base URL is unchanged otherwise.
/**
 * @param {string} mode 'off' | 'safe' | 'all' | 'nullable' (anything else => off)
 * @param {ReadonlyArray<unknown>} tools
 * @returns {Set<string>}
 */
export function resolveStrictToolNames(mode, tools) {
  const names = new Set()
  if (mode !== 'safe' && mode !== 'all' && mode !== 'nullable') {
    return names
  }
  for (const tool of tools ?? []) {
    const name = toolName(tool)
    if (!name) continue
    // 'nullable' selects every named tool like 'all' (the nullable rewrite never
    // forces an optional to be mandatory, so it is safe for every tool); only the
    // SANITIZER differs, which the renderer picks from the mode. EXCEPT a tool
    // whose schema has an open map (additionalProperties:<schema|true> or
    // patternProperties): the strict/nullable sanitizer silently clobbers it to
    // additionalProperties:false, inverting accept-any-keys to accept-NONE so the
    // model can no longer populate that param under server-side validation. Exclude
    // such tools — they go through the non-strict path (the open map keeps working,
    // just without /beta enforcement), exactly as 'safe' already excludes them.
    if (mode === 'all' || mode === 'nullable') {
      const schema = toolSchema(tool)
      if (schema !== null && schemaClosesAnOpenMap(schema)) continue
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

// True iff the schema declares an OPEN map anywhere — an `additionalProperties`
// that is a value schema or `true` (z.record / z.passthrough / an MCP author's
// free-form map), any `patternProperties`, or a property-less object node (a bare
// `{type:'object'}` whose additionalProperties defaults to OPEN per JSON Schema).
// The strict/nullable sanitizer unconditionally sets every object node's
// additionalProperties to false and drops patternProperties, which would close
// such a map (accept-any -> accept-none) silently. Absence of additionalProperties
// is NOT closed in general — it is only closeable on an object that ALSO declares
// `properties` (there strict's "reject undeclared extras" is the intended job);
// an object with NO declared properties is a free-form map and must stay open.
export function schemaClosesAnOpenMap(schema) {
  if (Array.isArray(schema)) return schema.some(schemaClosesAnOpenMap)
  if (!schema || typeof schema !== 'object') return false
  if (
    'additionalProperties' in schema &&
    schema.additionalProperties !== false
  ) {
    return true
  }
  if (
    schema.patternProperties &&
    typeof schema.patternProperties === 'object'
  ) {
    return true
  }
  // A `type:'object'` (or a type array including 'object') with no explicit
  // additionalProperties AND no declared properties is JSON-Schema default-open
  // (additionalProperties defaults to true). The sanitizer would rewrite it to
  // `{type:'object',required:[],additionalProperties:false}` = accepts only `{}`,
  // and force it into the parent's required[] — the #523 accept-any->accept-none
  // inversion, via an uncovered shape. An object WITH declared properties stays
  // selectable (absence-is-closed holds there — strict closes undeclared extras).
  const t = schema.type
  const isObjish = t === 'object' || (Array.isArray(t) && t.includes('object'))
  if (
    isObjish &&
    !('additionalProperties' in schema) &&
    !(
      schema.properties &&
      typeof schema.properties === 'object' &&
      Object.keys(schema.properties).length > 0
    )
  ) {
    return true
  }
  // Recurse every nested value (properties, items, anyOf, $defs, …); non-schema
  // values (strings, the required[] array) simply never match.
  return Object.keys(schema).some(key => schemaClosesAnOpenMap(schema[key]))
}
