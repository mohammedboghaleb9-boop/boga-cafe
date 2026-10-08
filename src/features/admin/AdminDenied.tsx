import { Link } from 'react-router';
import { adminAuth } from '@/data/api';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/shared/layout/Header';
import { Logo } from '@/shared/layout/Logo';
import { usePageTitle } from '@/shared/layout/usePageTitle';

/** Signed in with an account that is not an admin: it has been signed out again (src/data/supabase/adminAuth.ts). */
export function AdminDenied() {
  const { t } = useI18n();
  usePageTitle(t.admin.deniedTitle);
  return (
    <main className="admin-login">
      <div className="panel stack admin-login-card">
        <div className="spread">
          <Logo to="/" />
          <LanguageSwitcher />
        </div>
        <h1 className="admin-login-title">{t.admin.deniedTitle}</h1>
        <p className="notice notice-warn">{t.admin.deniedText}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={adminAuth.dismiss}>
          {t.admin.otherAccount}
        </button>
        <Link to="/" className="small muted">
          <span className="dir-arrow" aria-hidden="true">←</span> {t.admin.viewSite}
        </Link>
      </div>
    </main>
  );
}
