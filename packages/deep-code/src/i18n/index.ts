import { DEFAULT_LOCALE, normalizeLocale } from './locales.js'
import { EN_MESSAGES } from './messages/en.js'
import { ZH_HANS_MESSAGES } from './messages/zh-Hans.js'
import type { Locale, MessageCatalog, MessageParams, ResolveLocaleOptions } from './types.js'

const LOCALE_SETTING_KEY = 'locale'

const CATALOGS: Partial<Record<Locale, MessageCatalog>> = {
  en: EN_MESSAGES,
  'zh-Hans': ZH_HANS_MESSAGES,
}

let activeLocale: Locale = DEFAULT_LOCALE
const warnedMissingKeys = new Set<string>()

export function setActiveLocale(locale: string | null | undefined): Locale {
  activeLocale = normalizeLocale(locale)
  return activeLocale
}

export function getActiveLocale(): Locale {
  return activeLocale
}

export function resolveLocale(options: ResolveLocaleOptions = {}): Locale {
  return normalizeLocale(
    options.override ??
      options.settingsLocale ??
      readSettingsLocale(options.settings) ??
      options.env?.LC_ALL ??
      options.env?.LANG ??
      options.systemLocale ??
      getResolvedIntlLocale(),
  )
}

export function translate(
  locale: string | null | undefined,
  key: string,
  params?: MessageParams,
): string {
  const normalized = normalizeLocale(locale)
  const message = CATALOGS[normalized]?.[key] ?? EN_MESSAGES[key]

  if (message === undefined) {
    warnMissingKey(normalized, key)
    return key
  }

  return interpolate(message, params)
}

export function getMessage(key: string, params?: MessageParams): string {
  return translate(activeLocale, key, params)
}

function readSettingsLocale(
  settings: ResolveLocaleOptions['settings'],
): string | undefined {
  const value = settings?.[LOCALE_SETTING_KEY]
  return typeof value === 'string' ? value : undefined
}

function getResolvedIntlLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

function interpolate(message: string, params?: MessageParams): string {
  if (!params) return message

  return message.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}

function warnMissingKey(locale: Locale, key: string): void {
  if (process.env.NODE_ENV === 'production') return

  const warningKey = `${locale}:${key}`
  if (warnedMissingKeys.has(warningKey)) return
  warnedMissingKeys.add(warningKey)
  console.warn(`Missing i18n message: ${key} (${locale})`)
}
