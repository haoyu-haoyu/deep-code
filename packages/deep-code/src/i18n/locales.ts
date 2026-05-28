import type { Locale } from './types.js'

export const DEFAULT_LOCALE: Locale = 'en'

export const SUPPORTED_LOCALES = ['en', 'zh-Hans', 'ja'] as const

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES)

const SIMPLIFIED_CHINESE_REGIONS = new Set(['cn', 'sg'])

export function normalizeLocale(input: string | null | undefined): Locale {
  const raw = input?.trim()
  if (!raw) return DEFAULT_LOCALE

  const canonical = raw.replace(/_/g, '-')
  if (SUPPORTED_LOCALE_SET.has(canonical)) return canonical as Locale

  const lower = canonical.toLowerCase()
  if (lower === 'zh') return 'zh-Hans'
  if (lower === 'ja' || lower.startsWith('ja-')) return 'ja'

  const [language, region] = lower.split('-')
  if (language === 'zh' && (!region || SIMPLIFIED_CHINESE_REGIONS.has(region))) {
    return 'zh-Hans'
  }

  return DEFAULT_LOCALE
}

export function isSupportedLocale(input: string | null | undefined): input is Locale {
  return SUPPORTED_LOCALE_SET.has(input ?? '')
}
