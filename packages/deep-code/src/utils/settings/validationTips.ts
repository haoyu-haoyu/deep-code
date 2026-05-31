import type { ZodIssueCode } from 'zod/v4'

import { getMessage } from '../../i18n/index.js'

// v4 ZodIssueCode is a value, not a type - use typeof to get the type
type ZodIssueCodeType = (typeof ZodIssueCode)[keyof typeof ZodIssueCode]

export type ValidationTip = {
  suggestion?: string
  // Kept for back-compat; no longer populated (the upstream doc links pointed at
  // code.claude.com, which has no DeepCode equivalent — see the docs-URL cleanup).
  docLink?: string
}

export type TipContext = {
  path: string
  code: ZodIssueCodeType | string
  expected?: string
  received?: unknown
  enumValues?: string[]
  message?: string
  value?: unknown
}

type TipMatcher = {
  matches: (context: TipContext) => boolean
  // i18n catalog key for the suggestion text, or null when the suggestion is
  // built dynamically (e.g. enum values) in getValidationTip().
  suggestionKey: string | null
}

const TIP_MATCHERS: TipMatcher[] = [
  {
    matches: (ctx): boolean =>
      ctx.path === 'permissions.defaultMode' && ctx.code === 'invalid_value',
    suggestionKey: 'settings.validationTip.permissionsDefaultMode',
  },
  {
    matches: (ctx): boolean =>
      ctx.path === 'apiKeyHelper' && ctx.code === 'invalid_type',
    suggestionKey: 'settings.validationTip.apiKeyHelper',
  },
  {
    matches: (ctx): boolean =>
      ctx.path === 'cleanupPeriodDays' &&
      ctx.code === 'too_small' &&
      ctx.expected === '0',
    suggestionKey: 'settings.validationTip.cleanupPeriodDays',
  },
  {
    matches: (ctx): boolean =>
      ctx.path.startsWith('env.') && ctx.code === 'invalid_type',
    suggestionKey: 'settings.validationTip.env',
  },
  {
    matches: (ctx): boolean =>
      (ctx.path === 'permissions.allow' || ctx.path === 'permissions.deny') &&
      ctx.code === 'invalid_type' &&
      ctx.expected === 'array',
    suggestionKey: 'settings.validationTip.permissionsArray',
  },
  {
    matches: (ctx): boolean =>
      ctx.path.includes('hooks') && ctx.code === 'invalid_type',
    // gh-31187 / CC-282: prior example showed {"matcher": {"tools": ["BashTool"]}}
    // — an object format that never existed in the schema (matcher is z.string(),
    // always has been). Users copied the tip's example and got the same validation
    // error again. See matchesPattern() in hooks.ts: matcher is exact-match,
    // pipe-separated ("Edit|Write"), or regex. Empty/"*" matches all.
    suggestionKey: 'settings.validationTip.hooks',
  },
  {
    matches: (ctx): boolean =>
      ctx.code === 'invalid_type' && ctx.expected === 'boolean',
    suggestionKey: 'settings.validationTip.boolean',
  },
  {
    matches: (ctx): boolean => ctx.code === 'unrecognized_keys',
    suggestionKey: 'settings.validationTip.unrecognizedKeys',
  },
  {
    matches: (ctx): boolean =>
      ctx.code === 'invalid_value' && ctx.enumValues !== undefined,
    suggestionKey: null,
  },
  {
    matches: (ctx): boolean =>
      ctx.code === 'invalid_type' &&
      ctx.expected === 'object' &&
      ctx.received === null &&
      ctx.path === '',
    suggestionKey: 'settings.validationTip.malformedJson',
  },
  {
    matches: (ctx): boolean =>
      ctx.path === 'permissions.additionalDirectories' &&
      ctx.code === 'invalid_type',
    suggestionKey: 'settings.validationTip.additionalDirectories',
  },
]

export function getValidationTip(context: TipContext): ValidationTip | null {
  const matcher = TIP_MATCHERS.find(m => m.matches(context))

  if (!matcher) return null

  const tip: ValidationTip = {
    suggestion: matcher.suggestionKey
      ? getMessage(matcher.suggestionKey)
      : undefined,
  }

  if (
    context.code === 'invalid_value' &&
    context.enumValues &&
    !tip.suggestion
  ) {
    tip.suggestion = getMessage('settings.validationTip.validValues', {
      list: context.enumValues.map(v => `"${v}"`).join(', '),
    })
  }

  return tip
}
