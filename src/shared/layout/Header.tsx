import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useBrowseOnly, useDb } from '@/data/hooks';
import { DEMO_DATA } from '@/data/mode';
import { useCart } from '@/shared/cart/CartProvider';
import { useI18n } from '@/i18n';
import { Icon } from '../ui/Icon';
import { LanguageMenu, LanguageSwitcher } from './Language';
import { Logo } from './Logo';

export function Header() {
  const { t, l } = useI18n();
  const { count } = useCart();
  const { content } = useDb();
  // sales closed: one notice here, and no cart count (the cart page offers nothing to buy)
  const browseOnly = useBrowseOnly();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Escape closes the open menu and gives the focus back to its button
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setOpen(false);
  }

  // the shop's own filters (ShopPage reads ?kind=)
  const shopLinks = [
    { to: '/shop', label: t.shop.filterAll },
    { to: '/shop?kind=signature', label: t.shop.filterSignature },
    { to: '/shop?kind=single-origin', label: t.shop.filterSingle },
    { to: '/shop?kind=b2b', label: t.shop.filterB2B },
  ];
  const links = [
    { to: '/single-origin', label: t.nav.singleOrigin },
    { to: '/custom-blend', label: t.nav.customBlend },
    { to: '/b2b', label: t.nav.b2b },
  ];
  // the brand story on the home page until an About page exists
  const about = { to: '/#about', label: t.nav.about };
  const contact = { to: '/contact', label: t.nav.contact };

  return (
    <>
      {/* sales closed: the notice takes the announcement's place (its facts are in the home page ribbon) */}
      {browseOnly ? (
        <p className="sales-notice">
          <span className="container">{t.common.salesNotice}</span>
        </p>
      ) : (
        <div className="announce">
          <div className="container">{l(content.announcement)}</div>
        </div>
      )}
      {DEMO_DATA && (
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
        <div className="container wide site-header-row">
          <Logo />
          <nav className="main-nav" aria-label={t.a11y.mainNav}>
            <div className="nav-item">
              <NavLink to="/shop" className="nav-top">
                {t.nav.shop} <Icon name="chevron" size={14} />
              </NavLink>
              <div className="nav-sub">
                {shopLinks.map((link) => (
                  <Link key={link.to} to={link.to}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className="nav-top">
                {link.label}
              </NavLink>
            ))}
            <Link to={about.to} className="nav-top">
              {about.label}
            </Link>
            <NavLink to={contact.to} className="nav-top">
              {contact.label}
            </NavLink>
          </nav>
          <div className="header-tools">
            <LanguageSwitcher />
            <LanguageMenu />
            <Link to="/cart" className="cart-btn" aria-label={`${t.nav.cart} (${count})`}>
              <Icon name="cart" />
              {count > 0 && !browseOnly && <span className="cart-count num">{count}</span>}
            </Link>
            <button
              ref={menuButton}
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
            {[{ to: '/shop', label: t.nav.shop }, ...links].map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
            <Link to={about.to}>{about.label}</Link>
            <NavLink to={contact.to}>{contact.label}</NavLink>
            <LanguageSwitcher />
          </div>
        </nav>
      </header>
    </>
  );
}
