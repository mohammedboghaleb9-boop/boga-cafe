import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/shared/layout/Header';
import { Logo } from '@/shared/layout/Logo';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { isLowStock } from '@/core/stock';
import { PERMISSIONS, type Section } from './permissions';
import { adminSession, useAdminRole } from './session';
import { ConfirmButton } from './ui';

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
  const db = useDb();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const badges: Partial<Record<Section, number>> = {
    orders: db.orders.filter((o) => o.status === 'new').length,
    b2b: db.samples.filter((s) => s.status === 'new').length + db.quotes.filter((q) => q.status === 'new').length,
    stock: db.origins.filter(isLowStock).length,
    payments: db.orders.filter((o) => o.paymentStatus === 'awaiting_verification').length,
  };

  return (
    <div className="admin">
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={adminSession.signOut}>
            {t.admin.signOut}
          </button>
          <ConfirmButton
            label={t.admin.resetDemo}
            confirmLabel={t.admin.resetConfirm}
            onConfirm={api.resetDemo}
            className="btn btn-sm btn-link"
          />
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
