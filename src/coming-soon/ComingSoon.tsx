import { useLayoutEffect, useState } from 'react';
import label from '@/assets/brand/label.webp';
import type { Locale } from '@/core/types';
import { BOGA_CONTACT } from '@/data/contact';
import { Monogram } from '@/shared/layout/Monogram';
import { BrandIcon, brandName, type Brand } from '@/shared/ui/BrandIcon';
import { LOCALES, texts } from './texts';

/** The same language key as the full site (src/i18n), so a visitor keeps their choice when the shop opens. */
const STORAGE_KEY = 'boga-locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES.includes(saved as Locale)) return saved as Locale;
  } catch {
    /* ignore */
  }
  const nav = navigator.language.slice(0, 2);
  return LOCALES.includes(nav as Locale) ? (nav as Locale) : 'fr';
}

const c = BOGA_CONTACT;
const channels: { brand: Brand; href: string; text: string }[] = [
  { brand: 'whatsapp', href: `https://wa.me/${c.whatsapp.replace(/\D/g, '')}`, text: c.whatsapp },
  { brand: 'gmail', href: `mailto:${c.email}`, text: c.email },
  { brand: 'instagram', href: c.instagram, text: '@boga.cafe1' },
  { brand: 'tiktok', href: c.tiktok, text: '@bogacafe795' },
  { brand: 'facebook', href: c.facebook, text: 'BOGA CAFÉ' },
];

/**
 * The whole public site until the real catalog is ready: the brand, a "coming soon" line and the
 * real contact details. Every address shows this page (the old shop links included): there is no
 * catalog, price, cart or form in this build (vite.config.ts, scripts/check-real-build.mjs).
 */
export function ComingSoon() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const t = texts[locale];

  // before the first paint: an Arabic visitor never sees the page left to right
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = t.dir;
    document.title = t.pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  }, [locale, t]);

  const choose = (l: Locale) => {
    setLocale(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="soon">
      <div className="soon-langs" role="group" aria-label={t.language}>
        {LOCALES.map((l) => (
          <button key={l} type="button" lang={l} aria-pressed={l === locale} onClick={() => choose(l)}>
            {texts[l].name}
          </button>
        ))}
      </div>
      <header className="soon-head">
        <Monogram variant="emblem" className="soon-emblem" />
        <h1>{t.title}</h1>
        <p className="soon-lead">{t.lead}</p>
      </header>
      <img className="soon-label" src={label} width={720} height={1218} alt="BOGA CAFÉ" />
      <section className="soon-contact" aria-labelledby="soon-contact-title">
        <h2 id="soon-contact-title">{t.contact}</h2>
        <ul>
          {channels.map((ch) => (
            <li key={ch.brand}>
              <a href={ch.href} target={ch.brand === 'gmail' ? undefined : '_blank'} rel="noreferrer">
                <BrandIcon brand={ch.brand} size={36} />
                <span>
                  <span className="soon-channel">{brandName[ch.brand]}</span>
                  <bdi dir="ltr">{ch.text}</bdi>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="soon-place">
          <strong>{c.address[locale]}</strong>
          <span>
            {t.hours} {c.hours[locale]}
          </span>
        </p>
      </section>
    </main>
  );
}
