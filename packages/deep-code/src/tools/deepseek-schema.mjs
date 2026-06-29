import { omitUndefined } from '../utils/omitUndefined.mjs'

// DeepSeek V4 /beta strict function-calling accepts every JSON-Schema constraint
// keyword we emit — a live probe confirmed minLength/maxLength/minItems/maxItems
// (alongside minimum/maximum/pattern/enum) each return 200, NOT the 400 that the
// OpenAI structured-outputs subset gives. So nothing is stripped: keeping these
// lets V4 actually enforce a tool's declared bounds (e.g. AskUserQuestion's 2–4
// options). Re-add a keyword here only if a future model 400s on it.
const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set()

// The raw parameter-schema SOURCE for a tool — the 4-level fallback the rendered
// manifest reads. Exported as the single source of truth so anything that needs to
// KEY on a tool's schema (the manifest cache) reads the SAME fields and can never
// drift from what actually renders. Returns null when none is set (the renderer
// substitutes emptyObjectSchema()).
export function toolRawParameters(tool) {
  return (
    tool?.inputJSONSchema ??
    tool?.input_schema ??
    tool?.parameters ??
    tool?.function?.parameters ??
    null
  )
}

// The render KIND for a tool's parameter schema, derived from the strict signal.
// The signal may be a legacy boolean (true => 'all', false/undefined => off) or a
// mode string (off|safe|all|nullable). Both the renderer below and the manifest
// cache key read this SAME function (SSOT) so a tool rendered under one mode can
// never be served from a cache entry rendered under another.
//   'off'      -> stableClone (no /beta strict)
//   'strict'   -> sanitizeSchemaForDeepSeekStrict (safe/all: required = all props)
//   'nullable' -> sanitizeSchemaForDeepSeekNullable (required = all props, but the
//                 originally-optional ones are widened to allow null)
export function normalizeStrictMode(strict) {
  if (strict === 'nullable') return 'nullable'
  if (strict === true || strict === 'safe' || strict === 'all') return 'strict'
  return 'off'
}

export async function toolToDeepSeekFunctionSchema(tool, options = {}) {
  const description = await resolveToolDescription(tool, options)
  const rawParameters = toolRawParameters(tool) ?? emptyObjectSchema()
  const mode = normalizeStrictMode(options.strict)
  const parameters =
    mode === 'nullable'
      ? sanitizeSchemaForDeepSeekNullable(rawParameters)
      : mode === 'strict'
        ? sanitizeSchemaForDeepSeekStrict(rawParameters)
        : stableClone(rawParameters)

  return {
    type: 'function',
    function: omitUndefined({
      name: tool.name ?? tool.function?.name,
      description,
      parameters,
      // Both 'strict' and 'nullable' are /beta strict requests (the server enforces
      // the schema); nullable only differs in how OPTIONAL params are encoded.
      strict: mode === 'off' ? undefined : true,
    }),
  }
}

export function sanitizeSchemaForDeepSeekStrict(schema) {
  if (Array.isArray(schema)) {
    return schema.map(item => sanitizeSchemaForDeepSeekStrict(item))
  }
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const out = {}
  for (const key of Object.keys(schema).sort()) {
    if (UNSUPPORTED_STRICT_SCHEMA_KEYS.has(key)) continue
    const value = schema[key]
    // const/enum/default/examples/example are INSTANCE DATA, not subschemas — copy them
    // verbatim. Recursing lets the keyword special-cases and the object finalizer
    // below corrupt a DATA object that merely contains a key named like a schema
    // keyword (e.g. a const value {properties:[]} becomes properties:{} with an
    // injected type/required/additionalProperties), so the model's correct
    // emission no longer matches the const under /beta strict. stableClone keeps
    // the bytes deterministic (key-sorted), like the rest of the renderer.
    if (
      key === 'const' ||
      key === 'enum' ||
      key === 'default' ||
      key === 'examples' ||
      key === 'example'
    ) {
      out[key] = stableClone(value)
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = {}
      for (const prop of Object.keys(value).sort()) {
        out.properties[prop] = sanitizeSchemaForDeepSeekStrict(value[prop])
      }
      continue
    }
    if (key === 'items') {
      out.items = sanitizeSchemaForDeepSeekStrict(value)
      continue
    }
    if (key === 'anyOf' && Array.isArray(value)) {
      out.anyOf = value.map(item => sanitizeSchemaForDeepSeekStrict(item))
      continue
    }
    if ((key === '$defs' || key === '$def') && value && typeof value === 'object') {
      out[key] = {}
      for (const defName of Object.keys(value).sort()) {
        out[key][defName] = sanitizeSchemaForDeepSeekStrict(value[defName])
      }
      continue
    }
    out[key] = sanitizeSchemaForDeepSeekStrict(value)
  }

  return finalizeObjectNode(out)
}

// Strict-mode sanitizer variant that keeps required = ALL properties (so DeepSeek
// /beta strict accepts it) but widens each ORIGINALLY-OPTIONAL property to allow
// null — the OpenAI structured-outputs convention. A live V4 probe confirmed the
// server accepts required-but-nullable (200, all encodings) AND lets the model
// omit/null such a field, so an optional param is no longer forced to a value the
// way plain strict (required = all, non-nullable) does. Same recursion/key-sort as
// the strict sanitizer, so required props render BYTE-IDENTICAL to strict. Like the
// strict sanitizer it is applied EXACTLY ONCE on a raw schema; re-application is
// value- (deepEqual) idempotent — not byte-idempotent at an object root, since
// required/type/additionalProperties are appended after the sorted-key loop (a 2nd
// pass would sort them into place). That never reaches the wire (single application).
export function sanitizeSchemaForDeepSeekNullable(schema) {
  if (Array.isArray(schema)) {
    return schema.map(item => sanitizeSchemaForDeepSeekNullable(item))
  }
  if (!schema || typeof schema !== 'object') {
    return schema
  }
  // Capture the ORIGINAL required set BEFORE the overwrite below — it is the sole
  // optional-vs-required signal (zod v4 encodes optional as absence from required).
  // Captured per recursive frame, so a nested object widens against its OWN required.
  const origRequired = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  )

  const out = {}
  for (const key of Object.keys(schema).sort()) {
    if (UNSUPPORTED_STRICT_SCHEMA_KEYS.has(key)) continue
    const value = schema[key]
    // const/enum/default/examples/example are INSTANCE DATA, not subschemas — copy them
    // verbatim. Recursing lets the keyword special-cases and the object finalizer
    // below corrupt a DATA object that merely contains a key named like a schema
    // keyword (e.g. a const value {properties:[]} becomes properties:{} with an
    // injected type/required/additionalProperties), so the model's correct
    // emission no longer matches the const under /beta strict. stableClone keeps
    // the bytes deterministic (key-sorted), like the rest of the renderer.
    if (
      key === 'const' ||
      key === 'enum' ||
      key === 'default' ||
      key === 'examples' ||
      key === 'example'
    ) {
      out[key] = stableClone(value)
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = {}
      for (const prop of Object.keys(value).sort()) {
        const sanitized = sanitizeSchemaForDeepSeekNullable(value[prop])
        out.properties[prop] = origRequired.has(prop)
          ? sanitized
          : makeNullable(sanitized)
      }
      continue
    }
    if (key === 'items') {
      out.items = sanitizeSchemaForDeepSeekNullable(value)
      continue
    }
    if (key === 'anyOf' && Array.isArray(value)) {
      out.anyOf = value.map(item => sanitizeSchemaForDeepSeekNullable(item))
      continue
    }
    if ((key === '$defs' || key === '$def') && value && typeof value === 'object') {
      out[key] = {}
      for (const defName of Object.keys(value).sort()) {
        out[key][defName] = sanitizeSchemaForDeepSeekNullable(value[defName])
      }
      continue
    }
    out[key] = sanitizeSchemaForDeepSeekNullable(value)
  }

  return finalizeObjectNode(out)
}

// Apply the /beta strict object contract to a node the sanitizer judges to be an
// object: required = every declared property (sorted) and additionalProperties:false.
//
// Two things this gets right that the inline tail did not:
//   1. It gates on the node's ACTUAL type, NOT merely the presence of a `properties`
//      key. A non-object node that happens to carry a stray `properties` (e.g.
//      `{type:'string', properties:{…}}` from a hand-authored / MCP schema) is left
//      alone instead of being rewritten into a self-contradictory object — string
//      typed yet carrying required-property + additionalProperties:false constraints.
//   2. It normalizes the type to a BARE 'object'. DeepSeek /beta strict 400s on
//      'object' inside a `type` array (probe-documented; see NULLABLE_SCALAR_TYPES),
//      so a `type:['object','null']` node (a hand-authored / MCP nullable object)
//      would otherwise reach the wire as `type:['object','null']` + additionalProperties
//      :false and 400 the WHOLE request. Collapsing it to a plain object here avoids
//      that. An OPTIONAL property's nullability is reinstated downstream by
//      makeNullable in nullable mode (it anyOf-wraps the object, the server-accepted
//      encoding); strict mode keeps an object non-null by design.
function finalizeObjectNode(out) {
  const t = out.type
  const isObject =
    t === 'object' ||
    (Array.isArray(t) && t.includes('object')) ||
    (t === undefined && Boolean(out.properties))
  if (!isObject) return out
  out.type = 'object'
  out.required = Object.keys(out.properties ?? {}).sort()
  out.additionalProperties = false
  return out
}

// Widen a (already-sanitized) subschema to also permit null. Idempotent and shape-
// aware; leaves alone the cases where widening would corrupt or narrow.
function makeNullable(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  // Leave unchanged: already nullable; an empty schema (z.any/unknown — it already
  // accepts null, and adding a type would NARROW it); a bare $ref leaf (wrapping
  // could perturb ref resolution — an optional $ref stays required, same as 'all').
  if (isAlreadyNullable(schema) || isEmptySchema(schema) || '$ref' in schema) {
    return schema
  }
  // enum / const: wrap in anyOf with null — do NOT inject null into the enum list
  // (null is not one of the allowed values).
  if ('enum' in schema || 'const' in schema) {
    return { anyOf: [schema, { type: 'null' }] }
  }
  if (Array.isArray(schema.anyOf)) {
    return { ...schema, anyOf: [...schema.anyOf, { type: 'null' }] }
  }
  if (Array.isArray(schema.oneOf)) {
    return { ...schema, oneOf: [...schema.oneOf, { type: 'null' }] }
  }
  // A `type` ARRAY in DeepSeek /beta strict accepts ONLY scalar variants + null
  // (string|number|integer|boolean|null) — a live probe 400s on 'array'/'object' in
  // a type array. So only a SCALAR single-type can use the compact [type,'null']
  // encoding; an array/object (or any non-scalar) MUST wrap in anyOf with a null
  // branch instead.
  if (typeof schema.type === 'string' && NULLABLE_SCALAR_TYPES.has(schema.type)) {
    return { ...schema, type: [schema.type, 'null'] }
  }
  if (
    Array.isArray(schema.type) &&
    schema.type.every(type => NULLABLE_SCALAR_TYPES.has(type))
  ) {
    return { ...schema, type: [...schema.type, 'null'] }
  }
  // array / object / any other type shape → anyOf-wrap.
  return { anyOf: [schema, { type: 'null' }] }
}

// The scalar JSON-Schema types DeepSeek /beta strict permits inside a `type` array
// alongside "null". 'array' and 'object' are NOT permitted there (probe-confirmed).
const NULLABLE_SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

function isAlreadyNullable(schema) {
  if (schema.type === 'null') return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  for (const branchKey of ['anyOf', 'oneOf']) {
    const branches = schema[branchKey]
    if (
      Array.isArray(branches) &&
      branches.some(
        b =>
          b &&
          (b.type === 'null' ||
            (Array.isArray(b.type) && b.type.includes('null'))),
      )
    ) {
      return true
    }
  }
  return false
}

function isEmptySchema(schema) {
  const meaningful = [
    'type',
    'enum',
    'const',
    'anyOf',
    'oneOf',
    '$ref',
    'properties',
    'items',
  ]
  return !meaningful.some(key => key in schema)
}

async function resolveToolDescription(tool, options) {
  if (typeof tool.prompt === 'function') {
    return await tool.prompt({
      getToolPermissionContext:
        options.getToolPermissionContext ?? (async () => ({})),
      tools: options.tools ?? [],
      agents: options.agents ?? [],
      allowedAgentTypes: options.allowedAgentTypes,
    })
  }
  if (typeof tool.description === 'string') return tool.description
  if (typeof tool.function?.description === 'string') {
    return tool.function.description
  }
  return ''
}

function emptyObjectSchema() {
  return { type: 'object', properties: {}, required: [] }
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = stableClone(value[key])
  }
  return out
}
