import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatNumber } from '@/core/format';
import type { Locale, Localized } from '@/core/types';
import { ar } from './dictionaries/ar';
import { en, type Dict } from './dictionaries/en';
import { fr } from './dictionaries/fr';

export const LOCALES: Locale[] = ['ar', 'fr', 'en'];
const dictionaries: Record<Locale, Dict> = { ar, fr, en };
const STORAGE_KEY = 'boga-locale';

/** Replaces {name} placeholders. */
export const fmt = (text: string, vars: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES.includes(saved as Locale)) return saved as Locale;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'fr';
  return LOCALES.includes(nav as Locale) ? (nav as Locale) : 'fr';
}

interface I18n {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale) => void;
  /** Picks the current language from a { ar, fr, en } value (admin-edited content). */
  l: (value: Localized) => string;
  money: (amount: number) => string;
  date: (iso: string, withTime?: boolean) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const t = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = t.meta.dir;
  }, [locale, t]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      t,
      setLocale,
      l: (v) => v[locale] || v.fr || v.en,
      money: (amount) => `${formatNumber(amount)} ${t.common.currency}`,
      date: (iso, withTime = false) =>
        new Intl.DateTimeFormat(`${t.meta.intl}-u-nu-latn`, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        }).format(new Date(iso)),
    }),
    [locale, t, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
