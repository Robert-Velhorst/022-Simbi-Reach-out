import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import en from './locales/en.json'
import nl from './locales/nl.json'
import { parseTimestamp } from './timestamps'

export type Locale = 'en' | 'nl'
export type TranslationKey = keyof typeof en
export type Params = Record<string, string | number>
export type UiMessage = string | { key: TranslationKey; params?: Params; detail?: string }
export const LANGUAGE_STORAGE_KEY = 'simbi-ui-language-v1'
const catalogs: Record<Locale, Record<string, string>> = { en, nl }

export function translate(locale: Locale, key: TranslationKey, params: Params = {}): string {
  const pattern = catalogs[locale][key] ?? en[key]
  // Callback replacement keeps dollar signs and braces in values literal. React
  // escapes the result; no HTML parsing or recursive interpolation is performed.
  return pattern.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder)
}

export function readLocale(): Locale {
  try { return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'nl' ? 'nl' : 'en' }
  catch { return 'en' }
}

const I18nContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: 'en', setLocale: () => {} })

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(() => initialLocale ?? readLocale())
  const setLocale = useCallback((next: Locale) => {
    if (next !== 'en' && next !== 'nl') return
    updateLocale(next)
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next) } catch { /* Current-tab switching still works when storage is denied. */ }
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate(locale, 'Local-first, review-gated outreach operations'))
  }, [locale])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) updateLocale(readLocale())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const { locale, setLocale } = useContext(I18nContext)
  const t = useCallback((key: TranslationKey, params?: Params) => translate(locale, key, params), [locale])
  const formatMessage = useCallback((message: UiMessage): string => {
    if (typeof message !== 'string') {
      const detail = message.detail
      const localizedDetail = detail && Object.hasOwn(en, detail) ? t(detail as TranslationKey) : detail
      return t(message.key, { ...message.params, ...(detail === undefined ? {} : { detail: localizedDetail ?? '' }) })
    }
    // This formatter is only for explicit UI/status/error text, never record data.
    if (Object.hasOwn(en, message)) return t(message as TranslationKey)
    if (!message || locale === 'en') return message
    return t('The request could not be completed. Technical detail: {detail}', { detail: message })
  }, [locale, t])
  const formatCode = useCallback((code: string, separator = '_'): string => {
    const label = code.replaceAll(separator, ' ')
    return Object.hasOwn(en, label) ? t(label as TranslationKey) : label
  }, [t])
  const formatDate = useCallback((value: string | null | undefined): string => {
    if (!value) return t('Not set')
    const instant = parseTimestamp(value)
    return instant === null ? t('Unrecognized date: {value}', { value }) : new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant.milliseconds))
  }, [locale, t])
  return { locale, setLocale, t, formatMessage, formatDate, formatCode }
}

export function LanguagePicker() {
  const { locale, setLocale } = useI18n()
  return <label className="language-picker"><span className="sr-only">Language / Taal</span><select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="en" lang="en">English</option><option value="nl" lang="nl">Nederlands</option></select></label>
}
