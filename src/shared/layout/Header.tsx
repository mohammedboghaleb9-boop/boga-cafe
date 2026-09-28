import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import type { Locale } from '@/core/types';
import { useDb } from '@/data/hooks';
import { useCart } from '@/shared/cart/CartProvider';
import { LOCALES, useI18n } from '@/i18n';
import { ar } from '@/i18n/dictionaries/ar';
import { en } from '@/i18n/dictionaries/en';
import { fr } from '@/i18n/dictionaries/fr';
import { Icon } from '../ui/Icon';
import { Logo } from './Logo';

const labels: Record<Locale, string> = { ar: ar.meta.label, fr: fr.meta.label, en: en.meta.label };
const DEMO = import.meta.env.VITE_DATA_MODE !== 'supabase';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t.nav.language}>
      {LOCALES.map((l) => (
        <button key={l} type="button" aria-pressed={l === locale} onClick={() => setLocale(l)} lang={l}>
          {labels[l]}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const { t, l } = useI18n();
  const { count } = useCart();
  const { content } = useDb();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setOpen(false);
  }

  const links = [
    { to: '/shop', label: t.nav.shop },
    { to: '/single-origin', label: t.nav.singleOrigin },
    { to: '/custom-blend', label: t.nav.customBlend },
    { to: '/b2b', label: t.nav.b2b },
    { to: '/contact', label: t.nav.contact },
  ];

  return (
    <>
      <div className="announce">
        <div className="container">{l(content.announcement)}</div>
      </div>
      {DEMO && (
        <div className="demo-bar">
          <div className="container spread">
            <span>{t.demo.banner}</span>
            <Link to="/admin">
              {t.demo.openAdmin} <span className="dir-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      )}
      <header className="site-header">
        <div className="container site-header-row">
          <Logo />
          <nav className="main-nav" aria-label={t.a11y.mainNav}>
            {links.map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-tools">
            <LanguageSwitcher />
            <Link to="/cart" className="cart-btn" aria-label={`${t.nav.cart} (${count})`}>
              <Icon name="cart" />
              {count > 0 && <span className="cart-count num">{count}</span>}
            </Link>
            <button
              type="button"
              className="menu-btn btn-icon btn"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={t.nav.menu}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className="mobile-nav" hidden={!open} aria-label={t.a11y.mobileNav}>
          <div className="container stack">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
            <LanguageSwitcher />
          </div>
        </nav>
      </header>
    </>
  );
}
