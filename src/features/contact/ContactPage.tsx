import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { ChannelCards } from '@/shared/layout/ChannelCards';
import { Monogram } from '@/shared/layout/Monogram';
import { Icon } from '@/shared/ui/Icon';
import './contact.css';
import { usePageTitle } from '@/shared/layout/usePageTitle';

export function ContactPage() {
  const { t, l } = useI18n();
  usePageTitle(t.nav.contact);
  const { settings } = useDb();
  // saved before the hours existed: nothing to show
  const hours = settings.contact.hours ? l(settings.contact.hours).trim() : '';
  return (
    <div className="container page">
      <div className="page-head">
        <h1>{t.contact.title}</h1>
        <p className="lead">{t.contact.intro}</p>
      </div>

      <section className="stack contact-channels" aria-labelledby="channels-title">
        <div className="section-head">
          <h2 id="channels-title">{t.contact.channels}</h2>
          <p className="muted">{t.contact.channelsText}</p>
        </div>
        <ChannelCards />
      </section>

      <section className="contact-place">
        <Monogram variant="emblem" className="contact-emblem" />
        <div className="stack">
          <span className="label row">
            <Icon name="pin" size={18} /> {t.contact.address}
          </span>
          <strong className="contact-city">{l(settings.contact.address)}</strong>
          {hours && (
            <p className="row contact-hours">
              <Icon name="clock" size={18} /> <span className="label">{t.contact.hours}</span> <span>{hours}</span>
            </p>
          )}
          <p className="muted small">{t.footer.tagline}</p>
        </div>
      </section>
    </div>
  );
}
