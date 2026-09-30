import { Link } from 'react-router';
import { useI18n } from '@/i18n';
import { usePageTitle } from '@/shared/layout/usePageTitle';

/** /admin on the real site until phase 2 (src/data/mode.ts): nothing to sign in to yet. */
export function AdminUnavailable() {
  const { t } = useI18n();
  usePageTitle(t.admin.unavailableTitle);
  return (
    <main id="main" className="container page stack">
      <h1>{t.admin.unavailableTitle}</h1>
      <p className="lead">{t.admin.unavailableText}</p>
      <Link to="/" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
        {t.common.backHome}
      </Link>
    </main>
  );
}
