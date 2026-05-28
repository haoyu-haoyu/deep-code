import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import {
  getActiveLocale,
  resolveLocale,
  setActiveLocale,
  translate,
} from './index.js'
import type { Locale, MessageParams, ResolveLocaleOptions, Translator } from './types.js'

type TranslationContextValue = {
  locale: Locale
}

type TranslationProviderProps = {
  children: ReactNode
  locale?: string | null
  settings?: ResolveLocaleOptions['settings']
  env?: ResolveLocaleOptions['env']
}

const TranslationContext = createContext<TranslationContextValue | null>(null)

export function TranslationProvider({
  children,
  locale,
  settings,
  env,
}: TranslationProviderProps): ReactNode {
  const resolvedLocale = useMemo(() => {
    const nextLocale = resolveLocale({ override: locale, settings, env })
    setActiveLocale(nextLocale)
    return nextLocale
  }, [env, locale, settings])

  return createElement(
    TranslationContext.Provider,
    { value: { locale: resolvedLocale } },
    children,
  )
}

export function useTranslation(): Translator {
  const context = useContext(TranslationContext)
  const locale = context?.locale ?? getActiveLocale()

  return useMemo(
    () => ({
      locale,
      t(key: string, params?: MessageParams) {
        return translate(locale, key, params)
      },
    }),
    [locale],
  )
}
