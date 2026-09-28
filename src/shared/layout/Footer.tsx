import { Link } from 'react-router';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { formatPhone, gmailComposeLink } from '../contact';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '../ui/Icon';
import { Monogram } from './Monogram';
import { SocialLinks } from './SocialLinks';

export function Footer() {
  const { t, l } = useI18n();
  const { settings } = useDb();
  const c = settings.contact;
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Link to="/" className="footer-emblem" aria-label="BOGA CAFÉ">
            <Monogram variant="emblem" />
          </Link>
          <p className="muted small">{t.footer.tagline}</p>
        </div>
        <nav className="stack small" aria-label={t.footer.shop}>
          <strong>{t.footer.shop}</strong>
          <Link to="/shop">{t.nav.shop}</Link>
          <Link to="/single-origin">{t.nav.singleOrigin}</Link>
          <Link to="/custom-blend">{t.nav.customBlend}</Link>
          <Link to="/b2b">{t.nav.b2b}</Link>
        </nav>
        <nav className="stack small" aria-label={t.footer.help}>
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
        </nav>
        <div className="stack small footer-contact">
          <strong>{t.nav.contact}</strong>
          {c.whatsapp && (
            <a href={whatsappLink(c.whatsapp, t.contact.whatsappText)} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" size={16} />
              <span className="handle" dir="ltr">
                {formatPhone(c.whatsapp)}
              </span>
            </a>
          )}
          {c.email && (
            <a href={gmailComposeLink(c.email, t.contact.emailSubject)} target="_blank" rel="noreferrer">
              <Icon name="gmail" size={16} />
              <span className="handle" dir="ltr">
                {c.email}
              </span>
            </a>
          )}
          <span className="footer-line">
            <Icon name="pin" size={16} /> {l(c.address)}
          </span>
          <SocialLinks size={36} />
        </div>
      </div>
      <div className="container footer-bottom small muted">
        <span>
          © {new Date().getFullYear()} BOGA CAFÉ · {t.footer.rights}
        </span>
        <span className="footer-made">Oujda · Maroc</span>
      </div>
    </footer>
  );
}
