import { DEFAULT_LOCALE, normalizeLocale } from './locales.js'
import { EN_MESSAGES } from './messages/en.js'
import { JA_MESSAGES } from './messages/ja.js'
import { ZH_HANS_MESSAGES } from './messages/zh-Hans.js'
import type { Locale, MessageCatalog, MessageParams, ResolveLocaleOptions } from './types.js'

const LOCALE_SETTING_KEY = 'locale'

const CATALOGS: Partial<Record<Locale, MessageCatalog>> = {
  en: EN_MESSAGES,
  'zh-Hans': ZH_HANS_MESSAGES,
  ja: JA_MESSAGES,
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

// The first present env locale, skipping undefined and empty/whitespace-only
// strings. Inlined (not imported from utils/configValue) so the i18n module
// stays self-contained — the locale render tests copy only the i18n/ subtree.
// Mirrors utils/configValue.firstNonEmpty.
function firstNonEmptyEnvLocale(
  ...values: (string | undefined)[]
): string | undefined {
  for (const value of values) {
    if (value != null && value.trim() !== '') return value
  }
  return undefined
}

export function resolveLocale(options: ResolveLocaleOptions = {}): Locale {
  return normalizeLocale(
    options.override ??
      options.settingsLocale ??
      readSettingsLocale(options.settings) ??
      // firstNonEmptyEnvLocale (not ??): POSIX treats an EMPTY LC_ALL as "not
      // set", and `LC_ALL= LANG=zh_CN.UTF-8` (neutralize LC_ALL, keep LANG) is a
      // common container/shell pattern. `??` stops at the empty LC_ALL and
      // yields '' → normalizeLocale('') = 'en', ignoring the user's LANG. Skip
      // empty env locales so LANG (then systemLocale/Intl) is consulted.
      firstNonEmptyEnvLocale(options.env?.LC_ALL, options.env?.LANG) ??
      options.systemLocale ??
      getResolvedIntlLocale(),
  )
}

/**
 * Resolve and install the active UI locale at startup. Priority:
 *   --locale flag (override) → persisted GlobalConfig.locale → LC_ALL → LANG →
 *   system locale → 'en'. Call once early in the interactive boot path so
 *   useTranslation()/getMessage() consumers render in the chosen language.
 */
export function initActiveLocale(options: {
  override?: string | null
  configLocale?: string | null
  env?: ResolveLocaleOptions['env']
} = {}): Locale {
  return setActiveLocale(
    resolveLocale({
      override: options.override,
      settingsLocale: options.configLocale,
      env: options.env ?? (typeof process !== 'undefined' ? process.env : undefined),
    }),
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
