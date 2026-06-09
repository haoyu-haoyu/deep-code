import { omitUndefined } from '../utils/omitUndefined.mjs'

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set([
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
])

export async function toolToDeepSeekFunctionSchema(tool, options = {}) {
  const description = await resolveToolDescription(tool, options)
  const rawParameters =
    tool.inputJSONSchema ??
    tool.input_schema ??
    tool.parameters ??
    tool.function?.parameters ??
    emptyObjectSchema()
  const parameters = options.strict
    ? sanitizeSchemaForDeepSeekStrict(rawParameters)
    : stableClone(rawParameters)

  return {
    type: 'function',
    function: omitUndefined({
      name: tool.name ?? tool.function?.name,
      description,
      parameters,
      strict: options.strict ? true : undefined,
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

  if (out.type === 'object' || out.properties) {
    const propertyNames = Object.keys(out.properties ?? {}).sort()
    out.type = out.type ?? 'object'
    out.required = propertyNames
    out.additionalProperties = false
  }

  return out
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
