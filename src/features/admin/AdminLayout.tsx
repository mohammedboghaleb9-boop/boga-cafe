import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { adminAuth, api } from '@/data/api';
import { DEMO_DATA, SERVER_DATA } from '@/data/mode';
import { useAdminDataStatus, useAdminDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/shared/layout/Header';
import { Logo } from '@/shared/layout/Logo';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { isLowStock } from '@/core/stock';
import { PERMISSIONS, type Section } from './permissions';
import { useAdminRole } from './session';
import { ConfirmButton } from './ui';
import { SkipLink } from '@/shared/layout/SkipLink';
import { usePageTitle } from '@/shared/layout/usePageTitle';

const icons: Record<Section, IconName> = {
  dashboard: 'chart',
  orders: 'box',
  b2b: 'briefcase',
  products: 'tag',
  stock: 'scale',
  shipping: 'truck',
  payments: 'card',
  notifications: 'bell',
  content: 'file',
  settings: 'cog',
};

export function AdminLayout() {
  const { t } = useI18n();
  const role = useAdminRole()!;
  const db = useAdminDb();
  const { status, reload } = useAdminDataStatus();
  const { pathname } = useLocation();
  const current = pathname.split('/')[2] as Section | undefined;
  usePageTitle(`${(current && t.admin.nav[current]) || t.admin.nav.dashboard} · ${t.nav.admin}`);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- back to the top on each new page, on purpose
  }, [pathname]);

  // unpaid orders past the time limit give their stock back
  useEffect(() => {
    void api.expireUnpaidOrders();
  }, []);

  const badges: Partial<Record<Section, number>> = {
    orders: db.orders.filter((o) => o.status === 'new').length,
    b2b: db.quotes.filter((q) => q.status === 'new').length,
    stock: db.origins.filter(isLowStock).length,
    payments: db.orders.filter((o) => o.paymentStatus === 'awaiting_verification').length,
  };

  return (
    <div className="admin">
      <SkipLink />
      <aside className="admin-side">
        <div className="admin-brand">
          <Logo to="/admin" />
          <span className="pill pill-plain">{t.admin.roles[role]}</span>
        </div>
        <nav className="admin-nav" aria-label={t.admin.title}>
          {PERMISSIONS[role].map((section) => (
            <NavLink key={section} to={section === 'dashboard' ? '/admin' : `/admin/${section}`} end={section === 'dashboard'}>
              <Icon name={icons[section]} size={18} />
              <span>{t.admin.nav[section]}</span>
              {badges[section] ? <span className="nav-badge num">{badges[section]}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="admin-side-foot stack">
          <LanguageSwitcher />
          <Link to="/" className="btn btn-ghost btn-sm">
            <Icon name="external" size={14} /> {t.admin.viewSite}
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void adminAuth.signOut()}>
            {t.admin.signOut}
          </button>
          {DEMO_DATA && (
            <ConfirmButton
              label={t.admin.resetDemo}
              confirmLabel={t.admin.resetConfirm}
              onConfirm={() => void api.resetDemo()}
              className="btn btn-sm btn-link"
            />
          )}
        </div>
      </aside>
      <main className="admin-main" id="main" tabIndex={-1}>
        {/* live site: orders, stock and B2B can be changed (slice 8); the rest connects in slices 9-10 */}
        {SERVER_DATA && (
          <div className="admin-live-bar">
            <p className="notice notice-warn small">{t.admin.liveData}</p>
            <button type="button" className="btn btn-ghost btn-sm" aria-disabled={status === 'loading' || undefined} onClick={() => status !== 'loading' && reload()}>
              {t.admin.refresh}
            </button>
          </div>
        )}
        {status === 'ready' ? (
          <Outlet />
        ) : status === 'loading' ? (
          <p className="muted" role="status">
            {t.common.loading}
          </p>
        ) : (
          // a failed read or a session the database no longer counts as an admin: never an empty list
          <div className="stack" role="alert">
            <p className="notice notice-bad">{t.admin.dataFailed}</p>
            <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={reload}>
              {t.common.retry}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
