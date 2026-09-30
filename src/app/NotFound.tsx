import { Link } from 'react-router';
import { useI18n } from '@/i18n';
import { usePageTitle } from '@/shared/layout/usePageTitle';

export function NotFound() {
  const { t } = useI18n();
  usePageTitle(t.common.notFound);
  return (
    <div className="container page stack">
      <h1>404</h1>
      <p className="lead">{t.common.notFound}</p>
      <Link to="/" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
        {t.common.backHome}
      </Link>
    </div>
  );
}
