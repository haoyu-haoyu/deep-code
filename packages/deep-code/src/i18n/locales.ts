import type { Locale } from './types.js'

export const DEFAULT_LOCALE: Locale = 'en'

export const SUPPORTED_LOCALES = ['en', 'zh-Hans', 'ja'] as const

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES)

const SIMPLIFIED_CHINESE_REGIONS = new Set(['cn', 'sg'])

export function normalizeLocale(input: string | null | undefined): Locale {
  const raw = input?.trim()
  if (!raw) return DEFAULT_LOCALE

  // POSIX locale strings carry a codeset and/or modifier suffix —
  // 'zh_CN.UTF-8', 'de_DE@euro' — that must be stripped before parsing the
  // language-region. Without this, 'zh_CN.UTF-8' splits to region 'cn.utf'
  // (not in SIMPLIFIED_CHINESE_REGIONS) and falls through to 'en', so a user
  // with the standard LANG=zh_CN.UTF-8 wrongly gets an English UI.
  const canonical = raw.replace(/_/g, '-').split(/[.@]/)[0]!
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
