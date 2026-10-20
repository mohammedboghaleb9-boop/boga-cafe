import { Link } from 'react-router';
import { useI18n } from '@/i18n';
import { usePageTitle } from '@/shared/layout/usePageTitle';

/** /admin in a build of neither mode (`npm run dev` with no mode, src/data/mode.ts): no Admin Panel in it. */
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
