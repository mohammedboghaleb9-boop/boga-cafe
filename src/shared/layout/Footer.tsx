import { Link } from 'react-router';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Icon } from '../ui/Icon';
import { Logo } from './Logo';
import { SocialLinks } from './SocialLinks';

export function Footer() {
  const { t, l } = useI18n();
  const { settings } = useDb();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="stack">
          <Logo />
          <p className="muted small">{t.footer.tagline}</p>
          <p className="small row">
            <Icon name="pin" size={16} /> {l(settings.contact.address)}
          </p>
          <SocialLinks />
        </div>
        <div className="stack small">
          <strong>{t.footer.shop}</strong>
          <Link to="/shop">{t.nav.shop}</Link>
          <Link to="/single-origin">{t.nav.singleOrigin}</Link>
          <Link to="/custom-blend">{t.nav.customBlend}</Link>
          <Link to="/b2b">{t.nav.b2b}</Link>
        </div>
        <div className="stack small">
          <strong>{t.footer.help}</strong>
          <Link to="/contact">{t.nav.contact}</Link>
          <span className="muted">
            {t.footer.delivery} · {t.footer.soon}
          </span>
          <span className="muted">
            {t.footer.legal} · {t.footer.soon}
          </span>
          <span className="muted">
            {t.footer.privacy} · {t.footer.soon}
          </span>
          <Link to="/admin">{t.nav.admin}</Link>
        </div>
      </div>
      <div className="container footer-bottom small muted">
        © {new Date().getFullYear()} BOGA CAFÉ · {t.footer.rights}
      </div>
    </footer>
  );
}
