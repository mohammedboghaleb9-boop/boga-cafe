import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { SocialLinks } from '@/shared/layout/SocialLinks';
import { Icon } from '@/shared/ui/Icon';
import { CopyButton } from '@/shared/ui/bits';

export function ContactPage() {
  const { t, l } = useI18n();
  const { settings } = useDb();
  const c = settings.contact;
  return (
    <div className="container page">
      <div className="page-head">
        <h1>{t.contact.title}</h1>
        <p className="lead">{t.contact.intro}</p>
      </div>
      <div className="contact-grid">
        <div className="panel stack">
          <span className="label row">
            <Icon name="whatsapp" size={18} /> {t.common.whatsapp}
          </span>
          <div className="row">
            <strong className="num" dir="ltr">
              {c.whatsapp}
            </strong>
            <CopyButton text={c.whatsapp} />
          </div>
          <a className="btn btn-primary" style={{ alignSelf: 'flex-start' }} href={whatsappLink(c.whatsapp, t.contact.whatsappText)} target="_blank" rel="noreferrer">
            {t.common.openWhatsapp}
          </a>
        </div>
        <div className="panel stack">
          <span className="label row">
            <Icon name="mail" size={18} /> {t.common.email}
          </span>
          <div className="row">
            <strong>{c.email}</strong>
            <CopyButton text={c.email} />
          </div>
        </div>
        <div className="panel stack">
          <span className="label row">
            <Icon name="pin" size={18} /> {t.contact.address}
          </span>
          <strong>{l(c.address)}</strong>
        </div>
        <div className="panel stack">
          <span className="label">{t.contact.social}</span>
          <SocialLinks withLabels />
        </div>
      </div>
    </div>
  );
}
