export type Locale = 'en' | 'zh-Hans' | 'ja'

export type MessageParams = Record<string, string | number | boolean | null | undefined>

export type MessageCatalog = Record<string, string>

export type Translator = {
  locale: Locale
  t: (key: string, params?: MessageParams) => string
}

export type ResolveLocaleOptions = {
  override?: string | null
  settingsLocale?: string | null
  settings?: Record<string, unknown> | null
  env?: Partial<Record<string, string | undefined>>
  systemLocale?: string | null
}
