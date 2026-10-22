import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/core/types';
import { LOCALES, useI18n } from '@/i18n';
import { ar } from '@/i18n/dictionaries/ar';
import { en } from '@/i18n/dictionaries/en';
import { fr } from '@/i18n/dictionaries/fr';
import { Flag } from '../ui/Flag';
import { Icon } from '../ui/Icon';

/** Each language named in itself, with the flag the owner chose for it (2026-10-21). */
const names: Record<Locale, string> = { ar: ar.meta.label, fr: fr.meta.label, en: en.meta.label };
const flags: Record<Locale, string> = { ar: 'MA', fr: 'FR', en: 'GB' };

/** The three languages side by side: flag and code, the language's own name for screen readers. */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t.nav.language}>
      {LOCALES.map((l) => (
        <button key={l} type="button" aria-pressed={l === locale} aria-label={names[l]} onClick={() => setLocale(l)} lang={l}>
          <Flag code={flags[l]} size={21} title="" />
          <span aria-hidden="true">{l.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}

/** Phones: the current language as one button that opens the three, each on a full-width row. */
export function LanguageMenu() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // a tap outside or Escape closes the list; Escape gives the focus back to the button
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lang-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className="lang-chip"
        aria-expanded={open}
        aria-controls="lang-list"
        aria-label={`${t.nav.language}: ${names[locale]}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Flag code={flags[locale]} size={21} title="" />
        <span aria-hidden="true">{locale.toUpperCase()}</span>
        <Icon name="chevron" size={14} />
      </button>
      <div id="lang-list" className="lang-list" role="group" aria-label={t.nav.language} hidden={!open}>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={l === locale}
            onClick={() => {
              setLocale(l);
              setOpen(false);
            }}
          >
            <Flag code={flags[l]} size={21} title="" />
            <span>{names[l]}</span>
            <span className="lang-code" aria-hidden="true">
              {l.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
